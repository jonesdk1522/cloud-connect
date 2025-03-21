import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { createEC2Client } from './src/aws/client.js';
import { testConnectivity } from './src/connectivity.js';
import { getRegion } from './src/index.js';
import chalk from 'chalk';

export async function getAwsInstances(region, isGovCloud = false) {
  // Use the common client creation method that handles credentials
  const ec2Client = createEC2Client(region, isGovCloud);
  
  try {
    // Get data from AWS
    const data = await ec2Client.send(new DescribeInstancesCommand({}));
    
    // Collect instances details
    const instances = [];
    
    data.Reservations.forEach(reservation => {
      reservation.Instances.forEach(instance => {
        if (instance.State.Name === 'running') {
          instances.push({
            id: instance.InstanceId,
            privateIp: instance.PrivateIpAddress,
            publicIp: instance.PublicIpAddress || 'None',
            name: instance.Tags?.find(tag => tag.Key === 'Name')?.Value || 'Unnamed'
          });
        }
      });
    });
    
    return instances;
  } catch (err) {
    console.error("Error fetching EC2 instances:", err);
    throw err;
  }
}

export async function testAwsConnectivity(region, isGovCloud = false) {
  try {
    console.log(chalk.cyan(`Fetching EC2 instances from ${region}${isGovCloud ? ' (GovCloud)' : ''}...`));
    const instances = await getAwsInstances(region, isGovCloud);
    
    if (instances.length === 0) {
      console.log("No running instances found in this region.");
      return;
    }
    
    console.log(`Found ${instances.length} running instances.\n`);
    
    // Common ports to test
    const commonPorts = {
      'SSH': 22,
      'HTTP': 80,
      'HTTPS': 443
    };
    
    // Test connectivity to each instance
    for (const instance of instances) {
      console.log(`Testing connectivity to ${instance.name} (${instance.id}):`);
      
      // Only test if there's an IP to test
      if (instance.publicIp && instance.publicIp !== 'None') {
        try {
          console.log(`  Public IP (${instance.publicIp}):`);
          console.log(`  - Ping test:`);
          const pingResult = await testConnectivity(instance.publicIp, { 
            mode: 'ping',
            timeout: 3 
          });
          console.log(`    ${pingResult.success ? '✅' : '❌'} ${pingResult.message}`);
          
          // Test common TCP ports on public IP
          for (const [serviceName, port] of Object.entries(commonPorts)) {
            console.log(`  - ${serviceName} port test (${port}):`);
            const tcpResult = await testConnectivity(instance.publicIp, { 
              mode: 'tcp',
              port: port,
              timeout: 3
            });
            console.log(`    ${tcpResult.success ? '✅' : '❌'} ${tcpResult.message}`);
          }
        } catch (error) {
          console.log(`    ❌ Error testing public IP: ${error.message}`);
        }
      } else {
        console.log(`  No public IP available`);
      }

      if (instance.privateIp) {
        try {
          console.log(`  Private IP (${instance.privateIp}):`);
          console.log(`  - Ping test:`);
          const pingResult = await testConnectivity(instance.privateIp, { 
            mode: 'ping',
            timeout: 2 
          });
          console.log(`    ${pingResult.success ? '✅' : '❌'} ${pingResult.message}`);
          
          // Test common TCP ports on private IP
          for (const [serviceName, port] of Object.entries(commonPorts)) {
            console.log(`  - ${serviceName} port test (${port}):`);
            try {
              const tcpResult = await testConnectivity(instance.privateIp, { 
                mode: 'tcp',
                port: port,
                timeout: 2
              });
              console.log(`    ${tcpResult.success ? '✅' : '❌'} ${tcpResult.message}`);
            } catch (error) {
              console.log(`    ❌ Error testing ${serviceName}: ${error.message}`);
            }
          }
        } catch (error) {
          console.log(`    ❌ Error testing private IP: ${error.message}`);
        }
      }
      
      console.log('\n' + '-'.repeat(50) + '\n');
    }
  } catch (error) {
    console.error(chalk.red("Failed to test AWS connectivity:"), error);
  }
}

// If this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Detect if we're using a GovCloud profile first
  const isGovCloud = process.argv.includes('--gov-cloud') || 
                    (process.env.AWS_PROFILE && process.env.AWS_PROFILE.toLowerCase().includes('gov'));
  
  // Get region using the centralized approach - be explicit about GovCloud
  const region = getRegion(process.argv[2], isGovCloud);
  
  // Determine the effective region based on GovCloud status
  let effectiveRegion = region;
  if (isGovCloud && !region.startsWith('us-gov-')) {
    effectiveRegion = 'us-gov-west-1';
  }
  
  console.log(chalk.cyan(`Starting connectivity tests in region: ${effectiveRegion}${isGovCloud ? ' (GovCloud)' : ''}`));
  
  // Parse command line for port and IP
  let specificPort = null;
  let ip = null;
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('-') && !isNaN(parseInt(arg))) {
      specificPort = parseInt(arg);
      ip = process.argv[i + 1];
      break;
    }
  }
  
  if (specificPort && ip) {
    console.log(chalk.cyan(`Testing specific port ${specificPort} on IP ${ip}...`));
    testConnectivity(ip, { 
      mode: 'tcp',
      port: specificPort,
      timeout: 3
    }).then(result => {
      console.log(result);
    }).catch(err => {
      console.error("Test failed:", err);
    });
  } else {
    // Credentials will be handled by createEC2Client
    testAwsConnectivity(effectiveRegion, isGovCloud);
  }
}

// Export the test function for use by the CLI
export { testConnectivity };
