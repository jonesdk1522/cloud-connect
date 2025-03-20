import { DescribeVpcEndpointsCommand } from '@aws-sdk/client-ec2';
import { paginateCommand } from '../aws/pagination.js';
import chalk from 'chalk';

/**
 * List VPC endpoints with optional filters
 * @param {EC2Client} client - AWS EC2 client
 * @param {Array} filters - Optional filters
 * @returns {Array} - List of VPC endpoints
 */
export const listEndpoints = async (client, filters = []) => {
  try {
    const params = filters.length > 0 ? { Filters: filters } : {};
    return await paginateCommand(client, DescribeVpcEndpointsCommand, params, 'VpcEndpoints');
  } catch (error) {
    console.error(chalk.red('Error fetching VPC endpoints:'), error);
    throw error;
  }
};

/**
 * Get endpoints for a specific VPC
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} vpcId - VPC ID
 * @returns {Array} - List of VPC endpoints
 */
export const getEndpointsByVPC = async (client, vpcId) => {
  const filters = [
    {
      Name: 'vpc-id',
      Values: [vpcId],
    },
  ];
  return listEndpoints(client, filters);
};
