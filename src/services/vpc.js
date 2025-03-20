import { 
  DescribeVpcsCommand, 
  DescribeInternetGatewaysCommand, 
  DescribeNatGatewaysCommand, 
  DescribeSecurityGroupsCommand, 
  DescribeNetworkAclsCommand, 
  DescribeVpcPeeringConnectionsCommand 
} from '@aws-sdk/client-ec2';
import { paginateCommand } from '../aws/pagination.js';
import { createEC2Client } from '../aws/client.js'; // Add missing import
import chalk from 'chalk';

/**
 * List all VPCs in a region
 * @param {EC2Client} client - AWS EC2 client
 * @param {Array} filters - Optional filters to apply
 * @returns {Array} - List of VPCs
 */
export const listVPCs = async (client, filters = []) => {
  try {
    const params = filters.length > 0 ? { Filters: filters } : {};
    return await paginateCommand(client, DescribeVpcsCommand, params, 'Vpcs');
  } catch (error) {
    console.error(chalk.red('Error fetching VPCs:'), error);
    throw error;
  }
};

/**
 * Get details for a specific VPC
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} vpcId - VPC ID
 * @returns {Object} - VPC details
 */
export const getVPCDetails = async (client, vpcId) => {
  try {
    const command = new DescribeVpcsCommand({
      VpcIds: [vpcId],
    });
    const response = await client.send(command);
    
    if (!response.Vpcs || response.Vpcs.length === 0) {
      throw new Error(`VPC ${vpcId} not found`);
    }
    
    return response.Vpcs[0];
  } catch (error) {
    console.error(chalk.red(`Error fetching details for VPC ${vpcId}:`), error);
    throw error;
  }
};

/**
 * Get comprehensive details for a VPC
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} vpcId - VPC ID
 * @returns {Object} - Detailed VPC information
 */
export const getVPCFullDetails = async (client, vpcId) => {
  try {
    // Get basic VPC info
    const vpc = await getVPCDetails(client, vpcId);
    
    // Run these requests in parallel for better performance
    const [igwResponse, natResponse, sgResponse, naclResponse] = await Promise.all([
      // Get Internet Gateways
      client.send(new DescribeInternetGatewaysCommand({
        Filters: [{ Name: 'attachment.vpc-id', Values: [vpcId] }]
      })),
      
      // Get NAT Gateways
      client.send(new DescribeNatGatewaysCommand({
        Filter: [{ Name: 'vpc-id', Values: [vpcId] }]
      })),
      
      // Get Security Groups
      client.send(new DescribeSecurityGroupsCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }]
      })),
      
      // Get Network ACLs
      client.send(new DescribeNetworkAclsCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }]
      }))
    ]);
    
    // Return combined details
    return {
      vpc,
      internetGateways: igwResponse.InternetGateways || [],
      natGateways: natResponse.NatGateways || [],
      securityGroups: sgResponse.SecurityGroups || [],
      networkAcls: naclResponse.NetworkAcls || []
    };
  } catch (error) {
    console.error(chalk.red(`Error fetching full details for VPC ${vpcId}:`), error);
    throw error;
  }
};

/**
 * Gets all VPCs across multiple regions
 * @param {Array<string>} regions - List of AWS region names
 * @returns {Array} - Results with VPCs by region
 */
export const getVPCsByRegion = async (regions) => {
  const results = [];
  
  for (const region of regions) {
    try {
      console.log(`Checking region ${region}...`);
      const client = createEC2Client(region);
      const vpcs = await listVPCs(client);
      
      if (vpcs.length > 0) {
        results.push({ region, vpcs });
      }
    } catch (error) {
      console.error(`Error in region ${region}:`, error.message);
    }
  }
  
  return results;
};
