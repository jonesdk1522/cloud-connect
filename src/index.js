#!/usr/bin/env node

// Remove the Array.prototype modification that could cause conflicts

import { Command } from 'commander';
import chalk from 'chalk';
import { commands } from './cli/commands.js';
import { handleError } from './utils/errorHandler.js';

const program = new Command();

// Set up program metadata
program
  .name('cloud-connect')
  .description('AWS Network Infrastructure Viewer')
  .version('1.0.0');

// Global options
program
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-g, --gov-cloud', 'Use AWS GovCloud regions');

// VPC commands
program
  .command('vpcs')
  .description('List all VPCs')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listVPCs(region, isGovCloud);
    } catch (error) {
      handleError(error, 'DescribeVpcs');
    }
  });

// Add new command to list VPCs across all regions
program
  .command('all-vpcs')
  .description('List all VPCs across all AWS regions')
  .action(async (options, command) => {
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listAllRegionVPCs(isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Add a command to provide comprehensive VPC details
program
  .command('vpc-details')
  .description('Comprehensive report of a VPC and all associated resources')
  .option('-v, --vpc-id <vpcId>', 'VPC ID to examine')
  .option('-a, --all-regions', 'Check all regions')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.vpcDetails(region, options.vpcId, options.allRegions, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Subnet commands
program
  .command('subnets')
  .description('List all subnets')
  .option('-v, --vpc <vpcId>', 'Filter subnets by VPC ID')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listSubnets(region, options.vpc, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Route table commands
program
  .command('route-tables')
  .description('List route tables')
  .option('-v, --vpc <vpcId>', 'Filter route tables by VPC ID')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listRouteTables(region, options.vpc, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Transit gateway commands
program
  .command('transit-gateways')
  .description('List all transit gateways')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listTransitGateways(region, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('tgw-attachments')
  .description('List transit gateway attachments')
  .option('-t, --tgw <tgwId>', 'Transit Gateway ID (optional)')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listTGWAttachments(region, options.tgw, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('tgw-route-tables')
  .description('List transit gateway route tables')
  .option('-t, --tgw <tgwId>', 'Transit Gateway ID (optional)')
  .option('--type <type>', 'Filter routes by type (propagated, static)')
  .option('--state <state>', 'Filter routes by state (active, blackhole)')
  .option('--cidr <cidr>', 'Filter routes by CIDR block')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listTGWRouteTables(region, options.tgw, isGovCloud, {
        type: options.type,
        state: options.state,
        cidr: options.cidr
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// VPC Endpoints commands
program
  .command('endpoints')
  .description('List VPC endpoints')
  .option('-v, --vpc <vpcId>', 'Filter endpoints by VPC ID')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listEndpoints(region, options.vpc, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// PrivateLink commands
program
  .command('private-link')
  .description('List AWS PrivateLink services')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listPrivateLinkServices(region, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('private-link-service')
  .description('Get details for a specific AWS PrivateLink service')
  .argument('<serviceId>', 'Service ID to show details for')
  .action(async (serviceId, options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.getPrivateLinkServiceDetails(region, serviceId, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('endpoints-detailed')
  .description('List VPC endpoints with detailed information')
  .option('-v, --vpc <vpcId>', 'Filter endpoints by VPC ID')
  .option('-d, --detailed', 'Show detailed endpoint information')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listDetailedEndpoints(region, options.vpc, options.detailed, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('my-services')
  .description('List your AWS PrivateLink service configurations')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.listOwnPrivateLinkServices(region, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('modify-service-permissions')
  .description('Modify permissions for a PrivateLink service')
  .argument('<serviceId>', 'Service ID to modify')
  .argument('<principal>', 'AWS principal (account ID or ARN)')
  .option('-a, --action <action>', 'Action: add or remove', 'add')
  .action(async (serviceId, principal, options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    const action = options.action === 'remove' ? 'remove' : 'add';
    try {
      await commands.modifyPrivateLinkServicePermissions(region, serviceId, principal, action, isGovCloud);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Add network changes tracking commands
program
  .command('snapshot')
  .description('Take a snapshot of current network resources')
  .option('-n, --name <name>', 'Name for the snapshot')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    console.log(chalk.yellow(`Taking network snapshot for ${region}${isGovCloud ? ' (GovCloud)' : ''}...`));
    try {
      await commands.takeNetworkSnapshot(region, isGovCloud, options.name);
    } catch (error) {
      handleError(error, 'EC2General');
    }
  });

program
  .command('snapshot-all')
  .description('Take a snapshot of network resources across all regions')
  .option('-n, --name <name>', 'Name for the snapshot')
  .action(async (options, command) => {
    const isGovCloud = command.parent.opts().govCloud;
    console.log(chalk.yellow(`Taking network snapshot for all ${isGovCloud ? 'GovCloud ' : ''}regions...`));
    try {
      await commands.takeAllNetworkSnapshots(isGovCloud, options.name);
    } catch (error) {
      handleError(error, 'EC2General');
    }
  });

program
  .command('list-snapshots')
  .description('List available network snapshots')
  .action(async () => {
    try {
      await commands.listNetworkSnapshotHistory();
    } catch (error) {
      console.error(chalk.red('Error listing snapshots:'), error.message);
    }
  });

program
  .command('compare-snapshots')
  .description('Compare two network snapshots to detect changes')
  .argument('<snapshot1>', 'Name or ID of first (older) snapshot')
  .argument('[snapshot2]', 'Name or ID of second (newer) snapshot (defaults to latest)')
  .action(async (snapshot1, snapshot2) => {
    try {
      await commands.compareNetworkChanges(snapshot1, snapshot2);
    } catch (error) {
      console.error(chalk.red('Error comparing snapshots:'), error.message);
    }
  });

// Add drift detection command
program
  .command('check-drift')
  .description('Compare snapshot with current running environment')
  .argument('<snapshot>', 'Name of snapshot to compare against')
  .option('-a, --all-regions', 'Check all regions')
  .action(async (snapshot, options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    try {
      await commands.compareWithLive(snapshot, region, isGovCloud, options.allRegions);
    } catch (error) {
      console.error(chalk.red('Error checking drift:'), error.message);
    }
  });

// Add a permissions check command
program
  .command('check-permissions')
  .description('Check if you have permissions to use this tool')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    
    console.log(chalk.yellow(`\nChecking permissions in region ${region}${isGovCloud ? ' (GovCloud)' : ''}...`));
    
    let success = 0;
    let failure = 0;
    const failures = [];
    
    try {
      console.log(chalk.cyan('→ Testing DescribeRegions...'));
      await commands.listAllRegionVPCs(isGovCloud);
      console.log(chalk.green('✓ Permission check passed for DescribeRegions'));
      success++;
    } catch (error) {
      console.log(chalk.red('✗ Permission check failed for DescribeRegions'));
      failures.push('DescribeRegions');
      failure++;
    }
    
    try {
      console.log(chalk.cyan('→ Testing DescribeVpcs...'));
      await commands.listVPCs(region, isGovCloud);
      console.log(chalk.green('✓ Permission check passed for DescribeVpcs'));
      success++;
    } catch (error) {
      console.log(chalk.red('✗ Permission check failed for DescribeVpcs'));
      failures.push('DescribeVpcs');
      failure++;
    }
    
    console.log(chalk.yellow('\nPermission check complete!'));
    console.log(chalk.green(`Tests passed: ${success}`));
    console.log(chalk.red(`Tests failed: ${failure}`));
    
    if (failure > 0) {
      console.log(chalk.yellow('\nMissing permissions:'));
      failures.forEach(f => {
        const handler = { handleError };
        handler.handleError(new Error('Permission denied'), f);
      });
      
      console.log(chalk.cyan('\nCredential Setup:'));
      console.log('  1. Make sure AWS credentials are configured:');
      console.log('     - Via environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
      console.log('     - Or credentials file (~/.aws/credentials)');
      console.log('  2. Verify the IAM user/role has the necessary EC2 permissions');
    }
  });

// Add a command to configure AWS credentials
program
  .command('configure-credentials')
  .description('Configure AWS credentials')
  .option('--method <method>', 'Credential method: access-keys, profile, role, or web-identity', 'access-keys')
  .option('--save', 'Save credentials to configuration file', false)
  .action(async (options, command) => {
    try {
      await commands.configureCredentials(options.method, options.save);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Add a command to show currently configured credentials
program
  .command('current-credentials')
  .description('Show currently configured credentials')
  .action(async () => {
    try {
      await commands.showCurrentCredentials();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Helper function to adjust region for GovCloud
function getRegion(region, isGovCloud) {
  // If GovCloud is specified but the region doesn't look like a GovCloud region
  if (isGovCloud && !region.startsWith('us-gov-')) {
    if (region === 'us-east-1' || region === 'us-east-2') {
      return 'us-gov-east-1'; // Default to East GovCloud
    } else {
      return 'us-gov-west-1'; // Default to West GovCloud
    }
  }
  return region;
}

// Add a general help message
program.addHelpText('after', `
Examples:
  $ cloud-connect vpcs --region us-west-2
  $ cloud-connect subnets --vpc vpc-12345
  $ cloud-connect route-tables --vpc vpc-12345
  $ cloud-connect transit-gateways
  $ cloud-connect tgw-attachments --tgw tgw-12345
  $ cloud-connect endpoints --vpc vpc-12345
  $ cloud-connect snapshot --name baseline
  $ cloud-connect snapshot-all
  $ cloud-connect list-snapshots
  $ cloud-connect compare-snapshots baseline latest

Credentials:
  Configure AWS credentials via:
  - Environment variables: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
  - AWS credentials file (~/.aws/credentials)
  
  For GovCloud, use --gov-cloud flag and ensure you're using GovCloud credentials
`);

// Parse arguments and execute
program.parse(process.argv);
