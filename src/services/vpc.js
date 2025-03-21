import { 
  DescribeVpcsCommand, 
  DescribeInternetGatewaysCommand, 
  DescribeNatGatewaysCommand, 
  DescribeSecurityGroupsCommand, 
  DescribeNetworkAclsCommand, 
  DescribeVpcPeeringConnectionsCommand 
} from '@aws-sdk/client-ec2';
import { paginateCommand } from '../aws/pagination.js';
import { createEC2Client } from '../aws/client.js';
import chalk from 'chalk';

/**
 * Format VPC data for better readability
 * @param {Array} vpcs - Raw VPC data from AWS
 * @returns {Array} - Formatted VPC data
 */
const formatVPCData = (vpcs) => {
  return vpcs.map(vpc => ({
    VpcId: vpc.VpcId,
    CidrBlock: vpc.CidrBlock,
    State: vpc.State,
    IsDefault: vpc.IsDefault ? 'Yes' : 'No',
    Name: vpc.Tags?.find(tag => tag.Key === 'Name')?.Value || '-',
    OwnerId: vpc.OwnerId,
    DhcpOptionsId: vpc.DhcpOptionsId || '-'
  }));
};

/**
 * Format Internet Gateway data
 * @param {Array} igws - Raw IGW data
 * @returns {Array} - Formatted IGW data
 */
const formatIGWData = (igws) => {
  return igws.map(igw => ({
    InternetGatewayId: igw.InternetGatewayId,
    State: igw.Attachments?.[0]?.State || '-',
    Name: igw.Tags?.find(tag => tag.Key === 'Name')?.Value || '-'
  }));
};

/**
 * Format NAT Gateway data
 * @param {Array} nats - Raw NAT Gateway data
 * @returns {Array} - Formatted NAT Gateway data
 */
const formatNATData = (nats) => {
  return nats.map(nat => ({
    NatGatewayId: nat.NatGatewayId,
    SubnetId: nat.SubnetId,
    State: nat.State,
    Type: nat.ConnectivityType || 'public',
    PublicIp: nat.NatGatewayAddresses?.[0]?.PublicIp || '-',
    PrivateIp: nat.NatGatewayAddresses?.[0]?.PrivateIp || '-',
    Name: nat.Tags?.find(tag => tag.Key === 'Name')?.Value || '-'
  }));
};

/**
 * Format Security Group data
 * @param {Array} sgs - Raw Security Group data
 * @returns {Array} - Formatted Security Group data
 */
const formatSGData = (sgs) => {
  return sgs.map(sg => ({
    GroupId: sg.GroupId,
    GroupName: sg.GroupName,
    Description: sg.Description,
    IngressRules: sg.IpPermissions?.length || 0,
    EgressRules: sg.IpPermissionsEgress?.length || 0,
    Name: sg.Tags?.find(tag => tag.Key === 'Name')?.Value || '-'
  }));
};

/**
 * Format Network ACL data
 * @param {Array} acls - Raw NACL data
 * @returns {Array} - Formatted NACL data
 */
const formatNACLData = (acls) => {
  return acls.map(acl => ({
    NetworkAclId: acl.NetworkAclId,
    IsDefault: acl.IsDefault ? 'Yes' : 'No',
    IngressRules: acl.Entries?.filter(entry => !entry.Egress)?.length || 0,
    EgressRules: acl.Entries?.filter(entry => entry.Egress)?.length || 0,
    AssociatedSubnets: acl.Associations?.length || 0,
    Name: acl.Tags?.find(tag => tag.Key === 'Name')?.Value || '-'
  }));
};

/**
 * List all VPCs in a region
 * @param {EC2Client} client - AWS EC2 client
 * @param {Array} filters - Optional filters to apply
 * @returns {Array} - List of formatted VPCs
 */
export const listVPCs = async (client, filters = []) => {
  try {
    const params = filters.length > 0 ? { Filters: filters } : {};
    const vpcs = await paginateCommand(client, DescribeVpcsCommand, params, 'Vpcs');
    return formatVPCData(vpcs);
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
    
    // Return combined and formatted details
    return {
      vpc: formatVPCData([vpc])[0],
      internetGateways: formatIGWData(igwResponse.InternetGateways || []),
      natGateways: formatNATData(natResponse.NatGateways || []),
      securityGroups: formatSGData(sgResponse.SecurityGroups || []),
      networkAcls: formatNACLData(naclResponse.NetworkAcls || [])
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
