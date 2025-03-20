import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { 
  fromEnv,
  fromIni,
  fromTemporaryCredentials,
  fromWebToken
} from '@aws-sdk/credential-providers';
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
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
  await ensureConfigDir();
  
  // Don't save the actual credentials if method is profile
  const safeCredentials = {
    method,
    timestamp: new Date().toISOString(),
    ...credentials
  };
  
  // Remove sensitive data based on method
  if (method === 'profile') {
    delete safeCredentials.accessKeyId;
    delete safeCredentials.secretAccessKey;
  } else if (method === 'role') {
    // We keep the role ARN but remove the source credentials
    delete safeCredentials.sourceCredentials;
  }
  
  await fs.writeFile(
    CREDENTIALS_FILE,
    JSON.stringify(safeCredentials, null, 2),
    { mode: 0o600 } // Restrict read/write to the owner only
  );
  
  console.log(chalk.green(`Credentials saved to ${CREDENTIALS_FILE}`));
  
  // Apply credentials to future client creation
  await applyCredentialsToClients();
  
  return safeCredentials;
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
      message: 'Enter your AWS Access Key ID:',
      validate: input => input.trim() !== '' ? true : 'Access Key ID is required'
    },
    {
      type: 'password',
      name: 'secretAccessKey',
      message: 'Enter your AWS Secret Access Key:',
      mask: '*',
      validate: input => input.trim() !== '' ? true : 'Secret Access Key is required'
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
      message: 'Enter the IAM role ARN to assume:',
      validate: input => /^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[\w+=,.@-]+$/.test(input) 
        ? true 
        : 'Please enter a valid IAM role ARN (both standard and GovCloud ARNs are supported)'
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

// Test credentials
export async function testCredentials(credentials) {
  try {
    const provider = createCredentialProvider(credentials);
    const region = credentials.isGovCloud ? 'us-gov-west-1' : 'us-east-1';
    
    // Create an STS client with the credentials
    const sts = new STSClient({
      region,
      credentials: provider
    });
    
    // Test the credentials by calling GetCallerIdentity
    console.log(chalk.yellow('Testing credentials...'));
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    
    console.log(chalk.green('✅ Credentials are valid!'));
    console.log(chalk.cyan(`Account: ${identity.Account}`));
    console.log(chalk.cyan(`User ID: ${identity.UserId}`));
    console.log(chalk.cyan(`ARN: ${identity.Arn}`));
    
    // Also test if they can list EC2 regions (common permission)
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
    
    return true;
  } catch (error) {
    console.log(chalk.red(`❌ Credential validation failed: ${error.message}`));
    return false;
  }
}

// Create credential provider based on configuration
export function createCredentialProvider(config) {
  if (!config) {
    // Default to environment or ~/.aws/credentials
    return fromEnv();
  }
  
  switch (config.method) {
    case 'access-keys':
      // Create credentials directly from access keys
      return async () => ({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken
      });
      
    case 'profile':
      // Use profile from ~/.aws/credentials
      return fromIni({
        profile: config.profile
      });
      
    case 'role':
      // Assume role with source credentials
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
          region: config.isGovCloud ? 'us-gov-west-1' : 'us-east-1'
        },
        credentials: sourceProvider
      });
      
    case 'web-identity':
      // Web identity federation
      return fromWebToken({
        roleArn: config.roleArn,
        roleSessionName: config.sessionName || 'cloud-connect-web-session',
        webIdentityToken: fs.readFileSync(config.tokenFile, 'utf8')
      });
      
    default:
      // Default fallback to environment
      return fromEnv();
  }
}

// Main configuration function
export async function configureCredentialsInteractive(method = 'access-keys', save = true) {
  console.log(chalk.bold.cyan('\n=== AWS Credentials Configuration ===\n'));
  
  let credentials;
  
  // If method is not specified, prompt for it
  if (!method || method === 'interactive') {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: 'Choose credential configuration method:',
        choices: [
          { name: 'AWS Access Keys', value: 'access-keys' },
          { name: 'AWS Profile', value: 'profile' },
          { name: 'IAM Role', value: 'role' },
          { name: 'Web Identity', value: 'web-identity' }
        ]
      }
    ]);
    method = answers.method;
  }
  
  // Configure based on the method
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
    default:
      throw new Error(`Unknown credential method: ${method}`);
  }
  
  // Test the credentials
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
  
  // Save credentials if requested
  if (save) {
    await saveCredentials(credentials, method);
  }
  
  return credentials;
}
