#!/usr/bin/env node

// Remove the Array.prototype modification that could cause conflicts

import { Command } from 'commander';
import chalk from 'chalk';
import { commands } from './cli/commands.js';
import { handleError } from './utils/errorHandler.js';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

// Set up program metadata
program
  .name('cloud-connect')
  .description('AWS Network Infrastructure Viewer')
  .version('1.0.0');

// Global options
program
  .option('-r, --region [region]', 'AWS region (defaults to auto-detect)')
  .option('-g, --gov-cloud', 'Use AWS GovCloud regions');

// VPC commands
program
  .command('vpcs')
  .description('List all VPCs')
  .action(async (options, command) => {
    const region = command.parent.opts().region || undefined; // Pass undefined to use auto-detection
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

program
  .command('verify-credentials')
  .description('Verify if credentials file exists and is valid')
  .action(async () => {
    try {
      await commands.verifyCredentialsConfig();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Add connectivity test command
program
  .command('netcon-aws')
  .description('Test connectivity to EC2 instances')
  .option('-p, --port <port>', 'Test a specific TCP port')
  .option('-i, --ip <ip>', 'Test a specific IP address')
  .action(async (options, command) => {
    const region = getRegion(command.parent.opts().region, command.parent.opts().govCloud);
    const isGovCloud = command.parent.opts().govCloud;
    
    try {
      const { testAwsConnectivity, testConnectivity } = await import('../aws-connectivity-test.js');
      
      if (options.port && options.ip) {
        const port = parseInt(options.port);
        console.log(chalk.cyan(`Testing port ${port} on IP ${options.ip}...`));
        const result = await testConnectivity(options.ip, {
          mode: 'tcp',
          port: port,
          timeout: 3
        });
        console.log(result);
      } else {
        await testAwsConnectivity(region, isGovCloud);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Function to execute Go tools directly
function executeGoTool(toolName, args) {
  return new Promise((resolve, reject) => {
    const exeName = process.platform === 'win32' ? `${toolName}.exe` : toolName;
    const toolPath = path.join(__dirname, '../bin', exeName);
    const sourcePath = path.join(__dirname, '../network', `${toolName}.go`);
    
    console.log(chalk.blue(`Executing: ${toolPath} ${args.join(' ')}`));
    
    if (!fs.existsSync(toolPath)) {
      console.error(chalk.red(`Error: Binary ${exeName} not found in bin directory`));
      console.error(chalk.yellow('Build the Go binary first:'));
      console.error(chalk.yellow(`cd "${path.join(__dirname, '../network')}" && go build -o "${toolPath}" ${toolName}.go`));
      reject(new Error(`Binary ${toolName} not found. Build it first.`));
      return;
    }

    // Set executable permissions on Unix-like systems
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(toolPath, 0o755);
      } catch (err) {
        console.warn(chalk.yellow(`Warning: Could not set executable permissions: ${err.message}`));
      }
    }

    const options = {
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env, PATH: `${process.env.PATH}:${path.join(__dirname, '../bin')}` }
    };

    execFile(toolPath, args, options, (error, stdout, stderr) => {
      if (error) {
        console.error(chalk.red(`Error executing tool: ${error.message}`));
        if (stderr) console.error(chalk.red(`stderr: ${stderr}`));
        reject(error);
        return;
      }
      
      if (!stdout.trim()) {
        resolve({});
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        console.log(chalk.yellow('Raw output:'), stdout);
        reject(new Error(`Failed to parse output: ${e.message}`));
      }
    });
  });
}

// Connectivity testing (ping, TCP, UDP)
program
  .command('connectivity')
  .description('Test network connectivity (ping, TCP, UDP)')
  .argument('<target>', 'Target IP or hostname')
  .option('-m, --mode <mode>', 'Test mode: ping, tcp, udp, all', 'ping')
  .option('-p, --port <port>', 'Port for TCP/UDP tests', '80')
  .option('-t, --timeout <seconds>', 'Timeout in seconds', '5')
  .action(async (target, options) => {
    try {
      console.log(chalk.cyan(`Testing connectivity to ${target} using ${options.mode.toUpperCase()}...`));
      
      const args = [
        target,
        options.mode,
      ];
      
      if (options.mode === 'tcp' || options.mode === 'udp') {
        args.push(options.port);
      }
      
      args.push(options.timeout);
      
      const result = await executeGoTool('connectivity', args);
      console.log(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Traceroute command
program
  .command('traceroute')
  .description('Trace route to a target host')
  .argument('<target>', 'Target IP or hostname')
  .option('-m, --max-hops <hops>', 'Maximum number of hops', '30')
  .option('-t, --timeout <seconds>', 'Timeout in seconds', '60')
  .option('-n, --numeric', 'Use numeric output (no hostname resolution)', false)
  .action(async (target, options) => {
    try {
      console.log(chalk.cyan(`Tracing route to ${target}...`));
      
      const args = [
        target,
        options.maxHops,
        options.timeout,
        options.numeric ? 'true' : 'false'
      ];
      
      const result = await executeGoTool('traceroute', args);
      console.log(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Port scanning
program
  .command('port-scan')
  .description('Scan for open ports on a target host')
  .argument('<target>', 'Target IP or hostname')
  .argument('<port-range>', 'Port range to scan (e.g., 80,443 or 1-1000)')
  .option('-t, --timeout <seconds>', 'Timeout in seconds per port', '2')
  .option('-c, --concurrent <num>', 'Maximum concurrent port scans', '100')
  .action(async (target, portRange, options) => {
    try {
      console.log(chalk.cyan(`Scanning ports on ${target} (${portRange})...`));
      
      const args = [
        target,
        portRange,
        options.timeout,
        options.concurrent
      ];
      
      const result = await executeGoTool('portscan', args);
      console.log(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Network interfaces
program
  .command('interfaces')
  .description('Get information about network interfaces')
  .option('-i, --interface <name>', 'Specific interface to query', 'all')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('Getting network interface information...'));
      
      const args = [options.interface];
      
      const result = await executeGoTool('interfaces', args);
      console.log(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// HTTP testing
program
  .command('http-test')
  .description('Test HTTP/HTTPS endpoints')
  .argument('<url>', 'URL to test (comma-separated for multiple)')
  .option('-t, --timeout <seconds>', 'Timeout in seconds', '10')
  .option('-r, --no-redirects', 'Do not follow redirects', false)
  .option('-k, --insecure', 'Allow insecure SSL connections', false)
  .action(async (url, options) => {
    try {
      console.log(chalk.cyan(`Testing HTTP endpoint: ${url}...`));
      
      const args = [
        url,
        options.timeout,
        options.noRedirects ? '0' : '1',
        options.insecure ? '1' : '0'
      ];
      
      const result = await executeGoTool('http-test', args);
      console.log(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// DNS lookup
program
  .command('dns-lookup')
  .description('Look up DNS records')
  .argument('<domain>', 'Domain to look up (comma-separated for multiple)')
  .argument('<type>', 'Record type: a, aaaa, cname, mx, ns, txt, all (comma-separated for multiple)')
  .option('-s, --server <server>', 'DNS server to use', '')
  .option('-t, --timeout <seconds>', 'Timeout in seconds', '10')
  .action(async (domain, type, options) => {
    try {
      console.log(chalk.cyan(`Looking up DNS records for ${domain}...`));
      
      const args = [
        domain,
        type,
        options.server,
        options.timeout
      ];
      
      const result = await executeGoTool('dns', args);
      console.log(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Network scanning command
program
  .command('net-grab')
  .description('Scan network and collect host information')
  .argument('<cidr>', 'Network CIDR to scan (e.g., 192.168.1.0/24)')
  .action(async (cidr) => {
    try {
      console.log(chalk.cyan(`Starting network scan of ${cidr}...`));
      
      const result = await executeGoTool('net-grab', [cidr]);
      
      // Pretty print the results
      if (Array.isArray(result)) {
        console.log('\nDiscovered hosts:');
        result.forEach(host => {
          console.log(chalk.green(`\n${host.ip_address}:`));
          if (host.hostname) console.log(`  Hostname: ${host.hostname}`);
          console.log(`  Reachable: ${host.is_reachable}`);
          if (host.latency_ms) console.log(`  Latency: ${host.latency_ms}ms`);
          if (host.open_ports?.length) console.log(`  Open ports: ${host.open_ports.join(', ')}`);
          if (host.dns_names?.length) console.log(`  DNS names: ${host.dns_names.join(', ')}`);
        });
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      if (error.message.includes('ENOEXEC')) {
        console.log(chalk.yellow('\nRebuild the Go binary:'));
        console.log(`cd "${path.join(__dirname, '../network')}" && go build net-grab.go`);
      }
    }
  });

// Helper function to adjust region for GovCloud
export function getRegion(specifiedRegion, isGovCloud) {
  // If user explicitly specified a region via flag, use that
  if (specifiedRegion && specifiedRegion !== 'us-east-1') {
    // GovCloud check logic remains the same
    if (isGovCloud && !specifiedRegion.startsWith('us-gov-')) {
      return specifiedRegion === 'us-east-1' || specifiedRegion === 'us-east-2' 
        ? 'us-gov-east-1' 
        : 'us-gov-west-1';
    }
    return specifiedRegion;
  }
  
  // Try to get region from environment variables
  const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (envRegion) {
    console.log(chalk.blue(`Using region from environment: ${envRegion}`));
    return envRegion;
  }
  
  // Fall back to default region for synchronous code path
  // The async detection will happen in createEC2ClientAsync if needed
  console.log(chalk.yellow(`No region detected, using default: us-east-1`));
  return 'us-east-1';
}

// Add a general help message
program.addHelpText('after', `
Examples:
  AWS Infrastructure:
    # VPC Commands
    $ cloud-connect vpcs                            List VPCs in current region
    $ cloud-connect all-vpcs                        List VPCs across all regions
    $ cloud-connect vpc-details --vpc-id vpc-123    Detailed VPC report
    $ cloud-connect vpc-details --all-regions       Check VPCs in all regions

    # Subnet & Routing
    $ cloud-connect subnets --vpc vpc-123          List subnets for a VPC
    $ cloud-connect route-tables --vpc vpc-123      List route tables for a VPC

    # Transit Gateway
    $ cloud-connect transit-gateways               List all transit gateways
    $ cloud-connect tgw-attachments --tgw tgw-123  List TGW attachments
    $ cloud-connect tgw-route-tables --tgw tgw-123 List TGW route tables
                    [--type static|propagated]      Filter by route type
                    [--state active|blackhole]      Filter by route state
                    [--cidr 10.0.0.0/16]           Filter by CIDR block

    # PrivateLink & Endpoints
    $ cloud-connect endpoints --vpc vpc-123         List VPC endpoints
    $ cloud-connect endpoints-detailed --vpc vpc-123 Detailed endpoint info
    $ cloud-connect private-link                    List PrivateLink services
    $ cloud-connect private-link-service svc-123    Show service details
    $ cloud-connect my-services                     List your service configs
    $ cloud-connect modify-service-permissions \\
        svc-123 111122223333 --action add          Modify service permissions

  Network Change Management:
    $ cloud-connect snapshot --name baseline        Take network snapshot
    $ cloud-connect snapshot-all                    Snapshot all regions
    $ cloud-connect list-snapshots                  List saved snapshots
    $ cloud-connect compare-snapshots base latest   Compare snapshots
    $ cloud-connect check-drift baseline            Compare with live state

  Network Diagnostics:
    $ cloud-connect connectivity google.com -m tcp -p 443  Test connectivity
    $ cloud-connect traceroute cloudflare.com       Trace network path
    $ cloud-connect port-scan example.com 80,443    Scan ports
    $ cloud-connect interfaces                      List network interfaces
    $ cloud-connect http-test https://example.com   Test HTTP endpoints
    $ cloud-connect dns-lookup google.com all       DNS lookup
    $ cloud-connect net-grab 192.168.1.0/24        Network discovery scan

  AWS Connectivity Testing:
    $ cloud-connect netcon-aws                      Test AWS connectivity
    $ cloud-connect netcon-aws -p 443 -i 10.0.0.1  Test specific endpoint

  Credential Management:
    $ cloud-connect configure-credentials           Configure AWS credentials
    $ cloud-connect current-credentials             Show current credentials
    $ cloud-connect verify-credentials              Verify credential setup
    $ cloud-connect check-permissions               Check AWS permissions

Global Options:
  --region [region]      Specify AWS region (default: auto-detect)
  --gov-cloud           Use AWS GovCloud regions

Use "cloud-connect [command] --help" for detailed information about a command
`);

// Parse arguments and execute
(async () => {
  try {
    // Preload credentials before any command runs
    const { applyCredentialsToClients } = await import('./aws/client.js');
    
    console.log(chalk.blue('Initializing AWS credentials...'));
    await applyCredentialsToClients();
    
    // Show help if no arguments provided
    if (process.argv.length <= 2) {
      program.help();
      return;
    }
    
    // Now parse and execute commands
    program.parse(process.argv);
  } catch (error) {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    process.exit(1);
  }
})();