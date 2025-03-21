import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { 
  fromEnv,
  fromIni,
  fromTemporaryCredentials,
  fromWebToken,
  fromInstanceMetadata
} from '@aws-sdk/credential-providers';
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import https from 'https';
import chalk from 'chalk';
import { applyCredentialsToClients } from '../aws/client.js';

// Application config directory
const CONFIG_DIR = path.join(os.homedir(), '.cloud-connect');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

// Ensure config directory exists
async function ensureConfigDir() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Save credentials to file
export async function saveCredentials(credentials, method) {
  try {
    await ensureConfigDir();
    
    const safeCredentials = {
      method,
      timestamp: new Date().toISOString(),
      ...credentials
    };
    
    if (method === 'profile') {
      delete safeCredentials.accessKeyId;
      delete safeCredentials.secretAccessKey;
    } else if (method === 'role') {
      delete safeCredentials.sourceCredentials;
    }
    
    console.log(chalk.blue('Saving credential configuration:'));
    console.log(chalk.blue(`- Method: ${method}`));
    if (method === 'ec2-instance-metadata') {
      console.log(chalk.blue(`- Use current region: ${credentials.useCurrentRegion}`));
      if (!credentials.useCurrentRegion) {
        console.log(chalk.blue(`- Is GovCloud: ${credentials.isGovCloud}`));
        if (credentials.isGovCloud) {
          console.log(chalk.blue(`- GovCloud region: ${credentials.govCloudRegion}`));
        }
      }
    }
    
    console.log(chalk.blue(`Writing to credentials file: ${CREDENTIALS_FILE}`));
    
    const configData = JSON.stringify(safeCredentials, null, 2);
    await fs.writeFile(CREDENTIALS_FILE, configData, 'utf8');
    
    const fileExists = await fs.access(CREDENTIALS_FILE)
      .then(() => true)
      .catch(() => false);
    
    if (fileExists) {
      console.log(chalk.green('✅ Credentials saved successfully!'));
      return true;
    } else {
      console.log(chalk.red('❌ Failed to save credentials - file not found after write'));
      return false;
    }
  } catch (error) {
    console.error(chalk.red(`Error saving credentials: ${error.message}`));
    console.error(chalk.red(`Error details: ${error.stack}`));
    return false;
  }
}

// Load credentials from file
export async function loadCredentials() {
  try {
    const data = await fs.readFile(CREDENTIALS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Configure access key credentials
async function configureAccessKeys() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'accessKeyId',
      message: 'Enter your AWS Access Key ID (type ? for help):',
      validate: input => {
        if (input === '?') {
          console.log('\n' + chalk.cyan('Help: AWS Access Key ID'));
          console.log(chalk.yellow('Your AWS Access Key ID is a 20-character, alphanumeric string.'));
          console.log(chalk.yellow('Example: AKIAIOSFODNN7EXAMPLE'));
          return false; // Keep prompting
        }
        return input.trim() !== '' ? true : 'Access Key ID is required';
      }
    },
    {
      type: 'password',
      name: 'secretAccessKey',
      message: 'Enter your AWS Secret Access Key (type ? for help):',
      mask: '*',
      validate: input => {
        if (input === '?') {
          console.log('\n' + chalk.cyan('Help: AWS Secret Access Key'));
          console.log(chalk.yellow('Your AWS Secret Access Key is a 40-character, alphanumeric string.'));
          console.log(chalk.yellow('Example: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'));
          return false; // Keep prompting
        }
        return input.trim() !== '' ? true : 'Secret Access Key is required';
      }
    },
    {
      type: 'input',
      name: 'sessionToken',
      message: 'Enter your session token (leave empty if not applicable):',
    },
    {
      type: 'confirm',
      name: 'isGovCloud',
      message: 'Are these GovCloud credentials?',
      default: false
    }
  ]);
  
  return {
    method: 'access-keys',
    accessKeyId: answers.accessKeyId,
    secretAccessKey: answers.secretAccessKey,
    sessionToken: answers.sessionToken || undefined,
    isGovCloud: answers.isGovCloud
  };
}

// Configure profile credentials
async function configureProfile() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'profile',
      message: 'Enter the AWS profile name:',
      default: 'default',
      validate: input => input.trim() !== '' ? true : 'Profile name is required'
    },
    {
      type: 'confirm',
      name: 'isGovCloud',
      message: 'Is this a GovCloud profile?',
      default: false
    }
  ]);
  
  return {
    method: 'profile',
    profile: answers.profile,
    isGovCloud: answers.isGovCloud
  };
}

// Configure role assumption
async function configureRole() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'roleArn',
      message: 'Enter the IAM role ARN to assume (type ? for help):',
      validate: input => {
        if (input === '?') {
          console.log('\n' + chalk.cyan('Help: IAM Role ARN'));
          console.log(chalk.yellow('Format: arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME'));
          console.log(chalk.yellow('Example: arn:aws:iam::123456789012:role/MyServiceRole'));
          console.log(chalk.yellow('GovCloud Format: arn:aws-us-gov:iam::ACCOUNT_ID:role/ROLE_NAME'));
          console.log('\nTo find your role ARN:');
          console.log('1. Go to AWS IAM Console');
          console.log('2. Navigate to Roles');
          console.log('3. Select your role');
          console.log('4. Copy the ARN shown in the summary');
          console.log('\nNote: You need permission to assume this role');
          return false; // Keep prompting
        }
        return /^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[\w+=,.@-]+$/.test(input) 
          ? true 
          : 'Please enter a valid IAM role ARN (both standard and GovCloud ARNs are supported)';
      }
    },
    {
      type: 'input',
      name: 'sessionName',
      message: 'Enter a session name:',
      default: 'cloud-connect-session',
      validate: input => input.trim() !== '' ? true : 'Session name is required'
    },
    {
      type: 'list',
      name: 'sourceCredentialType',
      message: 'How would you like to authenticate to assume this role?',
      choices: [
        { name: 'Use current environment credentials', value: 'environment' },
        { name: 'Use a specific profile', value: 'profile' },
        { name: 'Enter access keys', value: 'access-keys' }
      ]
    },
    {
      type: 'input',
      name: 'profile',
      message: 'Enter the AWS profile name:',
      default: 'default',
      when: answers => answers.sourceCredentialType === 'profile'
    },
    {
      type: 'input',
      name: 'accessKeyId',
      message: 'Enter your AWS Access Key ID:',
      when: answers => answers.sourceCredentialType === 'access-keys',
      validate: input => input.trim() !== '' ? true : 'Access Key ID is required'
    },
    {
      type: 'password',
      name: 'secretAccessKey',
      message: 'Enter your AWS Secret Access Key:',
      mask: '*',
      when: answers => answers.sourceCredentialType === 'access-keys',
      validate: input => input.trim() !== '' ? true : 'Secret Access Key is required'
    },
    {
      type: 'confirm',
      name: 'isGovCloud',
      message: 'Is this for GovCloud?',
      default: false
    }
  ]);
  
  // Configure source credentials based on type
  let sourceCredentials;
  if (answers.sourceCredentialType === 'environment') {
    sourceCredentials = { type: 'environment' };
  } else if (answers.sourceCredentialType === 'profile') {
    sourceCredentials = { 
      type: 'profile',
      profile: answers.profile
    };
  } else if (answers.sourceCredentialType === 'access-keys') {
    sourceCredentials = {
      type: 'access-keys',
      accessKeyId: answers.accessKeyId,
      secretAccessKey: answers.secretAccessKey
    };
  }
  
  return {
    method: 'role',
    roleArn: answers.roleArn,
    sessionName: answers.sessionName,
    sourceCredentials,
    isGovCloud: answers.isGovCloud
  };
}

// Configure web identity
async function configureWebIdentity() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'roleArn',
      message: 'Enter the IAM role ARN to assume with web identity:',
      validate: input => /^arn:aws(-[a-z]+)?:iam::\d{12}:role\/[\w+=,.@-]+$/.test(input) 
        ? true 
        : 'Please enter a valid IAM role ARN'
    },
    {
      type: 'input',
      name: 'tokenFile',
      message: 'Enter the path to the web identity token file:',
      validate: async input => {
        try {
          await fs.access(input);
          return true;
        } catch (error) {
          return `File not accessible: ${error.message}`;
        }
      }
    },
    {
      type: 'input',
      name: 'sessionName',
      message: 'Enter a session name:',
      default: 'cloud-connect-web-session'
    },
    {
      type: 'confirm',
      name: 'isGovCloud',
      message: 'Is this for GovCloud?',
      default: false
    }
  ]);
  
  return {
    method: 'web-identity',
    roleArn: answers.roleArn,
    tokenFile: answers.tokenFile,
    sessionName: answers.sessionName,
    isGovCloud: answers.isGovCloud
  };
}

// Configure EC2 instance metadata credentials
async function configureEC2InstanceMetadata() {
  console.log(chalk.yellow('This method uses credentials from the EC2 Instance Metadata Service.'));
  console.log(chalk.yellow('This option only works when running on an EC2 instance.'));
  
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useCurrentRegion',
      message: 'Use current EC2 instance region (recommended)?',
      default: true
    },
    {
      type: 'confirm',
      name: 'isGovCloud',
      message: 'Is this for GovCloud?',
      default: false,
      when: answers => !answers.useCurrentRegion
    },
    {
      type: 'list',
      name: 'govCloudRegion',
      message: 'Which GovCloud region?',
      choices: [
        { name: 'US-Gov West (us-gov-west-1)', value: 'us-gov-west-1' },
        { name: 'US-Gov East (us-gov-east-1)', value: 'us-gov-east-1' }
      ],
      when: answers => !answers.useCurrentRegion && answers.isGovCloud
    }
  ]);
  
  return {
    method: 'ec2-instance-metadata',
    useCurrentRegion: answers.useCurrentRegion,
    isGovCloud: answers.useCurrentRegion ? false : (answers.isGovCloud || false),
    govCloudRegion: (!answers.useCurrentRegion && answers.isGovCloud) ? answers.govCloudRegion : undefined
  };
}

// Test credentials
export async function testCredentials(credentials) {
  try {
    console.log(chalk.yellow('Creating credential provider...'));
    const provider = createCredentialProvider(credentials);
    
    let region;
    
    if (credentials.method === 'ec2-instance-metadata' && credentials.useCurrentRegion) {
      console.log(chalk.yellow('Using current EC2 instance region for validation...'));
      region = await getEC2Region();
    } else {
      region = credentials.isGovCloud 
        ? (credentials.govCloudRegion || 'us-gov-west-1')
        : 'us-east-1';
      console.log(chalk.yellow(`Using region ${region} for validation...`));
    }
    
    const sts = new STSClient({
      credentials: provider,
      region
    });
    
    console.log(chalk.yellow('Testing credentials...'));
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    
    console.log(chalk.green('✅ Credentials are valid!'));
    console.log(chalk.cyan(`Account: ${identity.Account}`));
    console.log(chalk.cyan(`User ID: ${identity.UserId}`));
    console.log(chalk.cyan(`ARN: ${identity.Arn}`));
    
    if (!(credentials.method === 'ec2-instance-metadata' && credentials.useCurrentRegion)) {
      try {
        const ec2 = new EC2Client({
          region,
          credentials: provider
        });
        
        await ec2.send(new DescribeRegionsCommand({ MaxResults: 1 }));
        console.log(chalk.green('✅ EC2 permissions confirmed (DescribeRegions)'));
      } catch (error) {
        console.log(chalk.yellow('⚠️ EC2 permissions check failed. You may not have EC2 access.'));
      }
    }
    
    return true;
  } catch (error) {
    console.log(chalk.red(`❌ Credential validation failed: ${error.message}`));
    return false;
  }
}

// Function to get EC2 instance region from metadata service
function getEC2Region() {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue('Attempting to retrieve region via IMDSv2...'));
    
    // IMDSv2 approach (with token)
    const options = {
      timeout: 3000, // Shorter timeout for faster fallback
      host: '169.254.169.254',
      path: '/latest/meta-data/placement/region',
      method: 'GET',
      headers: {
        'X-aws-ec2-metadata-token-ttl-seconds': '21600'
      }
    };

    // First try IMDSv2 - get token
    const tokenReq = https.request({
      ...options,
      path: '/latest/api/token',
      method: 'PUT'
    }, (tokenRes) => {
      let token = '';
      
      tokenRes.on('data', (chunk) => {
        token += chunk;
      });
      
      tokenRes.on('end', () => {
        // Now use token to get region
        const regionReq = https.request({
          ...options,
          headers: {
            'X-aws-ec2-metadata-token': token
          }
        }, (regionRes) => {
          let region = '';
          
          regionRes.on('data', (chunk) => {
            region += chunk;
          });
          
          regionRes.on('end', () => {
            console.log(chalk.green('Successfully retrieved region via IMDSv2'));
            resolve(region.trim());
          });
        });
        
        regionReq.on('error', (error) => {
          console.log(chalk.yellow(`IMDSv2 region request failed: ${error.message}`));
          tryIMDSv1();
        });
        
        regionReq.on('timeout', () => {
          regionReq.destroy();
          console.log(chalk.yellow('IMDSv2 region request timed out, falling back to IMDSv1'));
          tryIMDSv1();
        });
        
        regionReq.end();
      });
    });
    
    tokenReq.on('error', (error) => {
      console.log(chalk.yellow(`IMDSv2 token request failed: ${error.message}`));
      tryIMDSv1();
    });
    
    tokenReq.on('timeout', () => {
      tokenReq.destroy();
      console.log(chalk.yellow('IMDSv2 token request timed out, falling back to IMDSv1'));
      tryIMDSv1();
    });
    
    tokenReq.end();
    
    // Fallback to IMDSv1 if IMDSv2 fails
    function tryIMDSv1() {
      console.log(chalk.blue('Attempting to retrieve region via IMDSv1...'));
      
      const imdsV1Req = https.request({
        timeout: 5000,
        host: '169.254.169.254',
        path: '/latest/meta-data/placement/region',
        method: 'GET',
      }, (response) => {
        let region = '';
        
        response.on('data', (chunk) => {
          region += chunk;
        });
        
        response.on('end', () => {
          if (region) {
            console.log(chalk.green('Successfully retrieved region via IMDSv1'));
            resolve(region.trim());
          } else {
            reject(new Error('Empty response from IMDSv1'));
          }
        });
      });
      
      imdsV1Req.on('error', (error) => {
        console.log(chalk.red(`IMDSv1 request failed: ${error.message}`));
        reject(error);
      });
      
      imdsV1Req.on('timeout', () => {
        imdsV1Req.destroy();
        console.log(chalk.red('IMDSv1 request timed out'));
        reject(new Error('IMDSv1 region request timed out'));
      });
      
      imdsV1Req.end();
    }
  });
}

// Create credential provider based on configuration
export function createCredentialProvider(config) {
  if (!config) {
    return fromEnv();
  }
  
  console.log(chalk.blue(`Creating credential provider using method: ${config.method}`));
  
  if (config.method === 'ec2-instance-metadata') {
    console.log(chalk.blue('Using EC2 instance metadata credentials'));
    
    if (config.useCurrentRegion) {
      console.log(chalk.blue('Attempting to detect region from EC2 instance metadata...'));
      try {
        return async () => {
          try {
            const detectedRegion = await getEC2Region();
            console.log(chalk.green(`Successfully detected region from metadata: ${detectedRegion}`));
            
            return fromInstanceMetadata({
              timeout: 10000,
              maxRetries: 5,
              region: detectedRegion,
              ignoreCache: false
            });
          } catch (error) {
            console.log(chalk.yellow(`Failed to auto-detect region: ${error.message}`));
            console.log(chalk.yellow('Falling back to default region: us-east-1'));
            
            return fromInstanceMetadata({
              timeout: 10000,
              maxRetries: 5,
              region: 'us-east-1',
              ignoreCache: false
            });
          }
        };
      } catch (error) {
        console.log(chalk.yellow(`Error initializing EC2 metadata client: ${error.message}`));
        console.log(chalk.yellow('Falling back to default configuration'));
      }
    }
    
    const region = config.isGovCloud 
      ? (config.govCloudRegion || 'us-gov-west-1')
      : 'us-east-1';
    
    return fromInstanceMetadata({
      timeout: 5000,
      maxRetries: 3,
      region: region
    });
  }
  
  const region = config.isGovCloud 
    ? (config.govCloudRegion || 'us-gov-west-1')
    : 'us-east-1';
  
  switch (config.method) {
    case 'access-keys':
      return async () => ({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken
      });
      
    case 'profile':
      return fromIni({
        profile: config.profile
      });
      
    case 'role':
      let sourceProvider;
      if (config.sourceCredentials.type === 'environment') {
        sourceProvider = fromEnv();
      } else if (config.sourceCredentials.type === 'profile') {
        sourceProvider = fromIni({
          profile: config.sourceCredentials.profile
        });
      } else if (config.sourceCredentials.type === 'access-keys') {
        sourceProvider = async () => ({
          accessKeyId: config.sourceCredentials.accessKeyId,
          secretAccessKey: config.sourceCredentials.secretAccessKey
        });
      }
      
      return fromTemporaryCredentials({
        params: {
          RoleArn: config.roleArn,
          RoleSessionName: config.sessionName || 'cloud-connect-session'
        },
        clientConfig: {
          region: region
        },
        credentials: sourceProvider
      });
      
    case 'web-identity':
      return fromWebToken({
        roleArn: config.roleArn,
        roleSessionName: config.sessionName || 'cloud-connect-web-session',
        webIdentityToken: fs.readFileSync(config.tokenFile, 'utf8')
      });
      
    case 'ec2-instance-metadata':
      return fromInstanceMetadata({
        timeout: 5000,
        maxRetries: 3,
        region: region
      });
      
    default:
      return fromEnv();
  }
}

// Main configuration function
export async function configureCredentialsInteractive(method = 'access-keys', save = true) {
  console.log(chalk.bold.cyan('\n=== AWS Credentials Configuration ===\n'));
  
  let credentials;
  
  if (!method || method === 'interactive' || method === '?') {
    console.log(chalk.yellow('Available credential methods:'));
    console.log('- access-keys: Direct AWS access key and secret key');
    console.log('- profile: Named profile from your AWS config file');
    console.log('- role: Assume an IAM role (requires source credentials)');
    console.log('- web-identity: Web identity federation');
    console.log('- ec2-instance-metadata: Use EC2 instance roles');
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: 'Choose credential configuration method:',
        choices: [
          { name: 'AWS Access Keys', value: 'access-keys' },
          { name: 'AWS Profile', value: 'profile' },
          { name: 'IAM Role', value: 'role' },
          { name: 'Web Identity', value: 'web-identity' },
          { name: 'EC2 Instance Metadata', value: 'ec2-instance-metadata' }
        ]
      }
    ]);
    method = answers.method;
  }
  
  switch (method) {
    case 'access-keys':
      credentials = await configureAccessKeys();
      break;
    case 'profile':
      credentials = await configureProfile();
      break;
    case 'role':
      credentials = await configureRole();
      break;
    case 'web-identity':
      credentials = await configureWebIdentity();
      break;
    case 'ec2-instance-metadata':
      credentials = await configureEC2InstanceMetadata();
      break;
    default:
      throw new Error(`Unknown credential method: ${method}`);
  }
  
  const valid = await testCredentials(credentials);
  
  if (!valid) {
    const retry = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'retry',
        message: 'Would you like to try again?',
        default: true
      }
    ]);
    
    if (retry.retry) {
      return configureCredentialsInteractive(method, save);
    }
    
    throw new Error('Credential validation failed. Configuration aborted.');
  }
  
  if (save) {
    await saveCredentials(credentials, method);
  }
  
  return credentials;
}

export async function verifyCredentialsFile() {
  try {
    const fileExists = await fs.access(CREDENTIALS_FILE)
      .then(() => true)
      .catch(() => false);
    
    if (!fileExists) {
      console.log(chalk.yellow('No credentials file found!'));
      return false;
    }
    
    const fileContent = await fs.readFile(CREDENTIALS_FILE, 'utf8');
    try {
      const credentials = JSON.parse(fileContent);
      console.log(chalk.green('Credentials file verification successful'));
      console.log(chalk.blue(`- Method: ${credentials.method}`));
      console.log(chalk.blue(`- Timestamp: ${credentials.timestamp}`));
      return true;
    } catch (error) {
      console.log(chalk.red(`Credentials file exists but contains invalid JSON: ${error.message}`));
      return false;
    }
  } catch (error) {
    console.log(chalk.red(`Error verifying credentials file: ${error.message}`));
    return false;
  }
}
