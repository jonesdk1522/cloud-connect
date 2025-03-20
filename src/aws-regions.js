const { EC2Client, DescribeRegionsCommand } = require('@aws-sdk/client-ec2');

async function fetchAwsRegions(config = {}) {
  try {
    // Properly initialize the client
    const client = new EC2Client(config);
    // Create command object
    const command = new DescribeRegionsCommand({});
    // Use send with the command
    const response = await client.send(command);
    
    return response.Regions.map(region => region.RegionName);
  } catch (error) {
    console.error("Error fetching AWS regions:", error);
    throw error;
  }
}

module.exports = { fetchAwsRegions };
