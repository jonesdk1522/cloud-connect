import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import { fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { 
  loadCredentials, 
  createCredentialProvider,
  getEC2Region
} from '../services/credentials.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Client cache to avoid creating redundant clients
const clientCache = new Map();

// Track if we're running on EC2
let isEC2Instance = null;
let cachedEC2Region = null;

let detectedRegion = null;
let isRegionDetectionInProgress = false;

/**
 * Check if we're running on an EC2 instance
 */
async function checkIfRunningOnEC2() {
  if (isEC2Instance !== null) return isEC2Instance;
  
  try {
    console.log(chalk.blue('Checking if running on EC2...'));
    cachedEC2Region = await getEC2Region();
    console.log(chalk.green(`✅ Running on EC2 in region: ${cachedEC2Region}`));
    isEC2Instance = true;
    return true;
  } catch (error) {
    console.log(chalk.yellow('Not running on EC2 or cannot access instance metadata'));
    isEC2Instance = false;
    return false;
  }
}

/**
 * Detect AWS region from multiple sources - without breaking existing code
 * This is initiated early but doesn't block client creation
 */
function detectAWSRegion() {
  // Only run detection once
  if (detectedRegion || isRegionDetectionInProgress) return;
  isRegionDetectionInProgress = true;
  
  // Start detection process asynchronously
  (async () => {
    try {
      // 1. Check environment variables
      if (process.env.AWS_REGION) {
        detectedRegion = process.env.AWS_REGION;
        console.log(chalk.green(`Region detected from AWS_REGION: ${detectedRegion}`));
        return;
      }
      
      if (process.env.AWS_DEFAULT_REGION) {
        detectedRegion = process.env.AWS_DEFAULT_REGION;
        console.log(chalk.green(`Region detected from AWS_DEFAULT_REGION: ${detectedRegion}`));
        return;
      }
      
      // 2. Check if running on EC2
      try {
        if (isEC2Instance === null) {
          await checkIfRunningOnEC2();
        }
        
        if (isEC2Instance && cachedEC2Region) {
          detectedRegion = cachedEC2Region;
          console.log(chalk.green(`Region detected from EC2 metadata: ${detectedRegion}`));
          return;
        }
      } catch (error) {
        // Not on EC2 or cannot access metadata service
      }
      
      // 3. Check AWS config file
      try {
        const configPath = path.join(os.homedir(), '.aws', 'config');
        if (fs.existsSync(configPath)) {
          const config = fs.readFileSync(configPath, 'utf8');
          
          // Check for active profile
          const profileToCheck = process.env.AWS_PROFILE || 'default';
          const profileRegex = new RegExp(`\\[profile ${profileToCheck === 'default' ? 'default' : profileToCheck}\\][^\\[]*?region\\s*=\\s*([^\\s]+)`, 's');
          const defaultRegex = /\[default\][^\[]*?region\s*=\s*([^\s]+)/s;
          
          const profileMatch = config.match(profileRegex);
          const defaultMatch = config.match(defaultRegex);
          
          if (profileMatch && profileMatch[1]) {
            detectedRegion = profileMatch[1];
            console.log(chalk.green(`Region detected from AWS config file (profile ${profileToCheck}): ${detectedRegion}`));
            return;
          } else if (defaultMatch && defaultMatch[1]) {
            detectedRegion = defaultMatch[1];
            console.log(chalk.green(`Region detected from AWS config file (default profile): ${detectedRegion}`));
            return;
          }
        }
      } catch (error) {
        // Error reading config file
      }
      
      // 4. Use fallback
      detectedRegion = 'us-east-1';
      console.log(chalk.yellow(`No region detected, using default: ${detectedRegion}`));
    } catch (error) {
      console.error(chalk.red(`Error detecting AWS region: ${error.message}`));
      detectedRegion = 'us-east-1';
    } finally {
      isRegionDetectionInProgress = false;
    }
  })();
}

/**
 * Creates or returns a cached AWS EC2 client
 */
export const createEC2Client = (region = null, isGovCloud = false) => {
  // Start region detection if it hasn't started yet
  detectAWSRegion();
  
  // If no region specified, try to use detected region
  if (!region && detectedRegion) {
    region = detectedRegion;
  } else if (!region) {
    // Fall back to original default if detection hasn't completed yet
    region = 'us-east-1';
  }
  
  // For GovCloud profiles, ensure we're using a GovCloud region
  if (process.env.AWS_PROFILE && process.env.AWS_PROFILE.toLowerCase().includes('gov')) {
    isGovCloud = true;
    if (!region.startsWith('us-gov-')) {
      region = 'us-gov-west-1';
      console.log(chalk.yellow(`GovCloud profile detected, using region: ${region}`));
    }
  }
  
  // If GovCloud flag is set, ensure we're using a GovCloud region
  if (isGovCloud && !region.startsWith('us-gov-')) {
    region = 'us-gov-west-1';
    console.log(chalk.yellow(`GovCloud mode enabled, using region: ${region}`));
  }
  
  // If we already know we're on EC2 and have a cached region, use it when no region is specified
  if (isEC2Instance === true && cachedEC2Region && (!region || region === 'us-east-1')) {
    region = cachedEC2Region;
    console.log(chalk.blue(`Using detected EC2 region: ${region}`));
  }
  
  // Create a cache key based on region and GovCloud flag
  const cacheKey = `${region}-${isGovCloud}`;
  
  // Return cached client if available
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey);
  }
  
  // If region is not specified (undefined or empty), use us-east-1 or us-gov-west-1 for GovCloud
  const effectiveRegion = (!region || region === '') 
    ? (isGovCloud ? 'us-gov-west-1' : 'us-east-1') 
    : region;

  console.log(chalk.blue(`Creating AWS client for region: ${effectiveRegion}`));

  // Create config for the client
  const clientConfig = { region: effectiveRegion };
  
  // Add credentials to config
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    // Environment variables take precedence
    console.log(chalk.green('Using access key credentials from environment variables'));
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    };
  } 
  else if (process.env.AWS_PROFILE) {
    // Profile takes second precedence
    console.log(chalk.green(`Using credentials from AWS profile: ${process.env.AWS_PROFILE}`));
    clientConfig.credentials = fromIni({
      profile: process.env.AWS_PROFILE,
      region: effectiveRegion
    });
  }
  else if (isEC2Instance === true) {
    // If we know we're on EC2, use instance metadata
    console.log(chalk.green('Using EC2 instance metadata credentials'));
    clientConfig.credentials = fromInstanceMetadata({
      timeout: 5000,
      maxRetries: 3
    });
  }
  else {
    // Default AWS credential chain
    console.log(chalk.yellow('Using default AWS credential provider chain'));
  }
  
  // Create the client with proper config
  const client = new EC2Client(clientConfig);
  clientCache.set(cacheKey, client);
  return client;
};

// Use credentials for future client creation
export const applyCredentialsToClients = async () => {
  try {
    // Clear cache to force credential refresh
    clientCache.clear();
    
    // Start region detection
    detectAWSRegion();
    
    // First check if we're on EC2 (for region and credential auto-detection)
    await checkIfRunningOnEC2();
    
    // First check existing environment variables (highest priority)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      console.log(chalk.green('✅ Using existing AWS access key credentials from environment'));
      return true;
    }
    
    // Then check for saved credentials in our config
    const savedCredentials = await loadCredentials();
    if (savedCredentials) {
      console.log(chalk.green(`Found saved credentials (${savedCredentials.method})`));
      
      // For EC2 instance metadata method, we don't need to do anything special
      // credentials will be fetched automatically by the AWS SDK
      if (savedCredentials.method === 'ec2-instance-metadata') {
        console.log(chalk.green('✅ Using EC2 instance metadata for credentials'));
        
        // If useCurrentRegion is true and we know our region, set it as an environment variable
        if (savedCredentials.useCurrentRegion && cachedEC2Region) {
          process.env.AWS_REGION = cachedEC2Region;
          console.log(chalk.green(`✅ Set AWS_REGION to "${cachedEC2Region}" from instance metadata`));
        }
        return true;
      }
      
      // For access-keys method, set environment variables
      if (savedCredentials.method === 'access-keys') {
        process.env.AWS_ACCESS_KEY_ID = savedCredentials.accessKeyId;
        process.env.AWS_SECRET_ACCESS_KEY = savedCredentials.secretAccessKey;
        if (savedCredentials.sessionToken) {
          process.env.AWS_SESSION_TOKEN = savedCredentials.sessionToken;
        }
        console.log(chalk.green('✅ Set environment variables from saved access keys'));
        return true;
      }
      
      // For profile method, set AWS_PROFILE
      if (savedCredentials.method === 'profile') {
        process.env.AWS_PROFILE = savedCredentials.profile;
        console.log(chalk.green(`✅ Set AWS_PROFILE to "${savedCredentials.profile}"`));
        return true;
      }
      
      // For other methods, try to resolve and set as environment variables
      try {
        const provider = createCredentialProvider(savedCredentials);
        const credentials = await resolveCredentials(provider);
        
        if (credentials && credentials.accessKeyId && credentials.secretAccessKey) {
          process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
          process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
          if (credentials.sessionToken) {
            process.env.AWS_SESSION_TOKEN = credentials.sessionToken;
          }
          console.log(chalk.green('✅ Set environment variables from resolved credentials'));
          return true;
        }
      } catch (error) {
        console.error(chalk.yellow(`Could not resolve credentials: ${error.message}`));
      }
    }
    
    // Existing AWS_PROFILE (already set before this app ran)
    if (process.env.AWS_PROFILE) {
      console.log(chalk.green(`✅ Using existing AWS_PROFILE: ${process.env.AWS_PROFILE}`));
      return true;
    }
    
    // On EC2, we can use instance metadata automatically
    if (isEC2Instance) {
      console.log(chalk.green('✅ Using EC2 instance metadata for credentials'));
      return true;
    }
    
    console.log(chalk.yellow('No explicit credentials configured - will use default AWS chain'));
    return true;
  } catch (error) {
    console.error(chalk.red(`Error in applyCredentialsToClients: ${error.message}`));
    return false;
  }
};

/**
 * Helper function to fully resolve credential providers to actual credentials
 * This handles the nested function providers that AWS SDK might return
 */
async function resolveCredentials(provider) {
  if (!provider) return null;
  
  try {
    // If it's a function, call it
    if (typeof provider === 'function') {
      const result = await provider();
      // Check if we got another function
      if (typeof result === 'function') {
        return await resolveCredentials(result);
      }
      return result;
    }
    
    // If it's a promise, resolve it
    if (provider && typeof provider.then === 'function') {
      const result = await provider;
      // Check if we got another function or promise
      if (typeof result === 'function' || (result && typeof result.then === 'function')) {
        return await resolveCredentials(result);
      }
      return result;
    }
    
    // If it has a getCredentials method (SDK credential providers)
    if (provider && typeof provider.getCredentials === 'function') {
      return await provider.getCredentials();
    }
    
    // Otherwise assume it's already credentials
    return provider;
  } catch (error) {
    console.error(chalk.yellow(`Error resolving credential provider: ${error.message}`));
    throw error;
  }
}

// Get all available AWS regions
export const getAllRegions = async (includeGovCloud = false) => {
  try {
    const client = createEC2Client('us-east-1', false); 
    const command = new DescribeRegionsCommand({
      AllRegions: includeGovCloud 
    });
    const response = await client.send(command);
    
    // Filter regions based on whether we want to include GovCloud
    let regions = response.Regions.map(region => region.RegionName);
    
    if (includeGovCloud) {
      return regions;
    } else {
      // Filter out GovCloud regions if not explicitly requested
      return regions.filter(region => !region.startsWith('us-gov-'));
    }
  } catch (error) {
    console.error(chalk.red('Error fetching AWS regions:'), error);
    throw error;
  }
};

// Get all GovCloud regions
export const getGovCloudRegions = async () => {
  try {
    const client = createEC2Client('us-gov-west-1', true);
    const command = new DescribeRegionsCommand({});
    const response = await client.send(command);
    return response.Regions.map(region => region.RegionName);
  } catch (error) {
    // Provide clear message for auth failures
    if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
      console.error(chalk.red('\nAWS GovCloud authentication failed. Make sure you have valid GovCloud credentials configured.'));
      console.error(chalk.yellow('Note: GovCloud credentials are separate from standard AWS credentials.'));
      console.error(chalk.yellow('You may need to run "aws configure --profile govcloud" to set them up.'));
    }
    
    // Return known regions if API call fails
    console.error(chalk.yellow('Falling back to known GovCloud regions...'));
    return ['us-gov-east-1', 'us-gov-west-1'];
  }
};

// Test credentials
export const testCredentials = async (isGovCloud = false) => {
  try {
    const region = isGovCloud ? 'us-gov-west-1' : 'us-east-1';
    const client = createEC2Client(region, isGovCloud);
    const command = new DescribeRegionsCommand({ MaxResults: 1 });
    await client.send(command);
    return true;
  } catch (error) {
    if (isGovCloud) {
      console.error(chalk.red(`GovCloud credential check failed: ${error.message}`));
      console.error(chalk.yellow('Note: GovCloud credentials are separate from standard AWS credentials.'));
    } else {
      console.error(chalk.red(`AWS credential check failed: ${error.message}`));
    }
    return false;
  }
};

// Initialize region detection at module load time
detectAWSRegion();
