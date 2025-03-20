import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { testConnectivity } from './src/connectivity.js';

async function getAwsInstances(region = 'us-east-1') {
  // Initialize EC2 client
  const ec2Client = new EC2Client({ region });
  
  try {
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

async function testAwsConnectivity(region = 'us-east-1') {
  try {
    console.log(`Fetching EC2 instances from ${region}...`);
    const instances = await getAwsInstances(region);
    
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
    console.error("Failed to test AWS connectivity:", error);
  }
}

// Allow region to be specified as command line argument
const region = process.argv[2] || 'us-east-1';

// Allow specific ports to be tested
const specificPort = parseInt(process.argv[3]);
if (!isNaN(specificPort)) {
  const ip = process.argv[4];
  if (ip) {
    console.log(`Testing specific port ${specificPort} on IP ${ip}...`);
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
    testAwsConnectivity(region);
  }
} else {
  testAwsConnectivity(region);
}
