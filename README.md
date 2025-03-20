# Cloud Connect Network Tools

A collection of network diagnostic tools and AWS network infrastructure management utilities with a Node.js interface.

## Table of Contents
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Linux Installation](#linux-installation)
  - [Manual Installation](#manual-installation)
- [Building the Tools](#building-the-tools)
- [Running Tests](#running-tests)
- [Available Tools](#available-tools)
  - [Network Diagnostic Tools](#network-diagnostic-tools)
  - [AWS Network Management Commands](#aws-network-management-commands)
- [Usage Examples](#usage-examples)
  - [Network Diagnostics](#network-diagnostics)
  - [AWS Infrastructure](#aws-infrastructure)
- [AWS and GovCloud Credentials](#aws-and-govcloud-credentials)
- [Tracking Network Changes](#tracking-network-changes)
  - [Taking Snapshots](#taking-snapshots)
  - [Comparing Snapshots](#comparing-snapshots)
  - [Drift Detection](#drift-detection)
- [Required IAM Permissions](#required-iam-permissions)
- [AWS GovCloud Regions](#aws-govcloud-regions)
- [Direct Execution](#direct-execution)
- [Contributing](#contributing)
- [License](#license)

## Installation

### Prerequisites

Cloud Connect requires the following dependencies:
- **Node.js and npm**: For running the CLI application
- **Go (Golang)**: Required for building the network utilities
- **AWS CLI**: Optional, but useful for configuring AWS credentials

### Linux Installation

For Linux systems, use the provided installation script:

```bash
# Make the script executable
chmod +x install.sh

# Run the installer
./install.sh
```

The installation script will:
1. Detect your Linux distribution
2. Install required dependencies (Node.js, npm, Go) if missing
3. Build the Go components
4. Install Node.js dependencies
5. Set up the global command

After installation, you can run the tool with:
```bash
cloud-connect --help
```

### Manual Installation

If you prefer to install manually:

```bash
# 1. Build the Go components
chmod +x build.sh
./build.sh

# 2. Install Node.js dependencies
npm install

# 3. Make the CLI tool globally available
chmod +x src/index.js
npm link
```

After these steps, you can use the `cloud-connect` command from any directory.

## Building the Tools

Before using the tools, you need to compile the Go binaries:

```bash
# Make the build script executable
chmod +x build.sh

# Run the build script
./build.sh
```

## Running Tests

To run tests for all network tools:

```bash
node test/test-network-tools.js
```

## Available Tools

### Network Diagnostic Tools

- **Connectivity Testing**: Check if a host is reachable via ping or TCP
- **Port Scanning**: Scan for open ports on a target host
- **Traceroute**: Trace the route to a target host
- **DNS Lookup**: Look up different DNS record types
- **Network Interfaces**: Get information about local network interfaces
- **HTTP Testing**: Test HTTP endpoints with detailed response information

### AWS Network Management Commands

- **VPC Management**: List, inspect, and analyze VPCs across regions
- **Subnet Management**: View and analyze subnet configurations and details
- **Route Tables**: Inspect route tables and their associations
- **Transit Gateways**: Analyze TGW configurations, attachments, and routes
- **VPC Endpoints**: Manage and analyze VPC endpoints and AWS PrivateLink services
- **Network Infrastructure Tracking**: Take snapshots and track infrastructure changes over time

## Usage Examples

### Network Diagnostics

```javascript
const networkTools = require('./src/network-tools');

// Test connectivity to Google's DNS
networkTools.testConnectivity('8.8.8.8')
  .then(result => console.log(result))
  .catch(err => console.error(err));

// Scan common ports
networkTools.scanPorts('example.com', '80-443')
  .then(result => console.log(result))
  .catch(err => console.error(err));
```

### AWS Infrastructure

List all VPCs in a region:
```bash
cloud-connect vpcs --region us-west-2
```

View detailed information about a specific VPC:
```bash
cloud-connect vpc-details --vpc vpc-12345678
```

List subnets in a VPC:
```bash
cloud-connect subnets --vpc vpc-12345678
```

List route tables for a VPC:
```bash
cloud-connect route-tables --vpc vpc-12345678
```

List all transit gateways:
```bash
cloud-connect transit-gateways
```

View transit gateway attachments:
```bash
cloud-connect tgw-attachments --tgw tgw-12345678
```

List VPC endpoints:
```bash
cloud-connect endpoints --vpc vpc-12345678
```

List PrivateLink services:
```bash
cloud-connect private-link
```

Get details about a specific PrivateLink service:
```bash
cloud-connect private-link-service vpce-svc-12345678
```

View your own PrivateLink service configurations:
```bash
cloud-connect my-services
```

## AWS and GovCloud Credentials

### Standard AWS Credentials

For standard AWS credentials, set up your credentials using:
```bash
aws configure
```

### GovCloud Credentials

GovCloud environments require separate credentials. To set them up:
```bash
# Set up a specific profile for GovCloud
aws configure --profile govcloud

# Use the profile when running commands
AWS_PROFILE=govcloud cloud-connect vpcs --gov-cloud
```

Alternatively, you can set the environment variable for your session:
```bash
export AWS_PROFILE=govcloud
cloud-connect vpc-details --gov-cloud
```

## Tracking Network Changes

Cloud Connect allows you to track changes to your AWS network infrastructure by taking and comparing snapshots.

### Taking Snapshots

Take a snapshot of network resources in a specific region:
```bash
cloud-connect snapshot --name baseline
```

Take a snapshot across all AWS regions:
```bash
cloud-connect snapshot-all --name baseline-all-regions
```

List available snapshots:
```bash
cloud-connect list-snapshots
```

### Comparing Snapshots

Compare two snapshots to identify changes:
```bash
cloud-connect compare-snapshots baseline latest
```

### Drift Detection

Compare a snapshot with the current live environment to detect configuration drift:
```bash
cloud-connect check-drift baseline
```

Check drift across all regions:
```bash
cloud-connect check-drift baseline --all-regions
```

Snapshots are stored locally in a `snapshots` directory as JSON files.

## Required IAM Permissions

To use all features of this tool, your AWS credentials should have the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeRegions",
        "ec2:DescribeSubnets",
        "ec2:DescribeRouteTables",
        "ec2:DescribeInternetGateways",
        "ec2:DescribeNatGateways",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeNetworkAcls",
        "ec2:DescribeVpcEndpoints",
        "ec2:DescribeVpcEndpointServices",
        "ec2:DescribeVpcEndpointServiceConfigurations",
        "ec2:DescribeVpcEndpointServicePermissions",
        "ec2:DescribeVpcEndpointConnections",
        "ec2:DescribeVpcPeeringConnections",
        "ec2:DescribeTransitGateways",
        "ec2:DescribeTransitGatewayAttachments",
        "ec2:DescribeTransitGatewayRouteTables"
      ],
      "Resource": "*"
    }
  ]
}
```

You can check your current permissions and ensure everything is configured correctly with:
```bash
cloud-connect check-permissions
```

### AWS GovCloud Regions

AWS GovCloud has the following regions:
- us-gov-east-1 (US East)
- us-gov-west-1 (US West)

Use the `--gov-cloud` flag with commands to work with GovCloud regions.

## Direct Execution

To run the CLI tool directly without typing `npm start --`:

```bash
# Make the file executable
chmod +x src/index.js

# Create a symlink to make it available globally
npm link
```

After linking, you can use the tool directly:

```bash
cloud-connect vpc-details --vpc vpc-12345678 --gov-cloud
cloud-connect vpc-details --all-regions
cloud-connect snapshot --name baseline
cloud-connect compare-snapshots baseline latest
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
