import { DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { paginateCommand } from '../aws/pagination.js';

/**
 * List all subnets with optional filters
 * @param {EC2Client} client - AWS EC2 client
 * @param {Array} filters - Optional filters
 * @returns {Array} - List of subnets
 */
export const listSubnets = async (client, filters = []) => {
  try {
    const params = filters.length > 0 ? { Filters: filters } : {};
    return await paginateCommand(client, DescribeSubnetsCommand, params, 'Subnets');
  } catch (error) {
    console.error('Error fetching subnets:', error);
    throw error;
  }
};

/**
 * Get subnets by VPC ID
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} vpcId - VPC ID to filter by
 * @returns {Array} - List of subnets in the VPC
 */
export const getSubnetsByVPC = async (client, vpcId) => {
  const filters = [
    {
      Name: 'vpc-id',
      Values: [vpcId],
    },
  ];
  return listSubnets(client, filters);
};
