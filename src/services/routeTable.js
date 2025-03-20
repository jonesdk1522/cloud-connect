import { DescribeRouteTablesCommand } from '@aws-sdk/client-ec2';

export const listRouteTables = async (client, filters = []) => {
  try {
    const command = new DescribeRouteTablesCommand({ Filters: filters });
    const response = await client.send(command);
    return response.RouteTables;
  } catch (error) {
    console.error('Error fetching route tables:', error);
    throw error;
  }
};

export const getRouteTablesByVPC = async (client, vpcId) => {
  const filters = [
    {
      Name: 'vpc-id',
      Values: [vpcId],
    },
  ];
  return listRouteTables(client, filters);
};
