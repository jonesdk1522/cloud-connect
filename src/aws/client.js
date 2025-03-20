import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import { 
  loadCredentials, 
  createCredentialProvider
} from '../services/credentials.js';

// Client cache to avoid creating redundant clients
const clientCache = new Map();

/**
 * Creates or returns a cached AWS EC2 client
 * @param {string} region - AWS region
 * @param {boolean} isGovCloud - Whether to use GovCloud endpoints
 * @returns {EC2Client} - AWS EC2 client instance
 */
export const createEC2Client = (region = 'us-east-1', isGovCloud = false) => {
  // Normalize region based on GovCloud flag
  let effectiveRegion = region;
  
  // Handle GovCloud regions
  if (isGovCloud || region.startsWith('us-gov-')) {
    isGovCloud = true;
    
    if (!region.startsWith('us-gov-')) {
      effectiveRegion = region.includes('east') ? 'us-gov-east-1' : 'us-gov-west-1';
      console.warn(chalk.yellow(`Converting ${region} to GovCloud region: ${effectiveRegion}`));
    }
  }
  
  // Create a cache key that accounts for both region and GovCloud status
  const cacheKey = `${effectiveRegion}-${isGovCloud}`;
  
  // Return cached client if available
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey);
  }
  
  try {
    // We'll handle credentials synchronously to maintain compatibility
    // with existing code. For custom credentials, they'll be applied next time
    // the application runs after configuration.
    
    // Fix: Use correct retry configuration format per AWS SDK v3
    const client = new EC2Client({
      region: effectiveRegion,
      maxAttempts: 3,
      retryMode: 'standard'
    });
    
    // Cache the client for future use
    clientCache.set(cacheKey, client);
    return client;
  } catch (error) {
    if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
      if (isGovCloud) {
        throw new Error(`AWS GovCloud authentication failed for region ${effectiveRegion}. Make sure you have valid GovCloud credentials configured.`);
      } else {
        throw new Error(`AWS authentication failed for region ${effectiveRegion}. Make sure you have valid credentials configured.`);
      }
    }
    throw error;
  }
};

/**
 * Creates an AWS EC2 client with custom credentials
 * This is used by credential commands but not for regular operations
 * to avoid breaking existing code
 */
export const createEC2ClientWithCredentials = async (region = 'us-east-1', isGovCloud = false) => {
  // Normalize region based on GovCloud flag
  let effectiveRegion = region;
  
  // Handle GovCloud regions
  if (isGovCloud || region.startsWith('us-gov-')) {
    isGovCloud = true;
    
    if (!region.startsWith('us-gov-')) {
      effectiveRegion = region.includes('east') ? 'us-gov-east-1' : 'us-gov-west-1';
    }
  }
  
  try {
    // Load configured credentials
    const savedCredentials = await loadCredentials();
    let credentials = undefined;
    
    if (savedCredentials) {
      // Override isGovCloud if specified in saved credentials
      if (savedCredentials.isGovCloud) {
        isGovCloud = true;
        if (!effectiveRegion.startsWith('us-gov-')) {
          effectiveRegion = effectiveRegion.includes('east') ? 'us-gov-east-1' : 'us-gov-west-1';
        }
      }
      
      // Create credential provider from saved configuration
      credentials = createCredentialProvider(savedCredentials);
    }
    
    return new EC2Client({
      region: effectiveRegion,
      maxAttempts: 3,
      retryMode: 'standard',
      credentials
    });
  } catch (error) {
    if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
      if (isGovCloud) {
        throw new Error(`AWS GovCloud authentication failed for region ${effectiveRegion}. Make sure you have valid GovCloud credentials configured.`);
      } else {
        throw new Error(`AWS authentication failed for region ${effectiveRegion}. Make sure you have valid credentials configured.`);
      }
    }
    throw error;
  }
};

// Use credentials for future client creation (called after configuration)
export const applyCredentialsToClients = async () => {
  try {
    // Clear existing cache to force recreation with new credentials
    clientCache.clear();
    
    // Load saved credentials for future client creation
    const savedCredentials = await loadCredentials();
    if (savedCredentials) {
      console.log(chalk.green('Loaded saved AWS credentials'));
    }
    return true;
  } catch (error) {
    console.error('Error applying credentials:', error);
    return false;
  }
};

// Get all available AWS regions
export const getAllRegions = async (includeGovCloud = false) => {
  try {
    const client = createEC2Client('us-east-1', false);
    const command = new DescribeRegionsCommand({
      // Include all regions if we're looking for GovCloud
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
    // Create a client in a GovCloud region
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
