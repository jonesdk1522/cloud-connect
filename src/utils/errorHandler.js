import chalk from 'chalk';

// Map of AWS API calls to the required IAM permissions
const permissionMap = {
  // EC2 VPC operations
  DescribeVpcs: ['ec2:DescribeVpcs'],
  DescribeRegions: ['ec2:DescribeRegions'],
  DescribeSubnets: ['ec2:DescribeSubnets'],
  DescribeRouteTables: ['ec2:DescribeRouteTables'],
  DescribeInternetGateways: ['ec2:DescribeInternetGateways'],
  DescribeNatGateways: ['ec2:DescribeNatGateways'],
  DescribeSecurityGroups: ['ec2:DescribeSecurityGroups'],
  DescribeNetworkAcls: ['ec2:DescribeNetworkAcls'],
  DescribeVpcEndpoints: ['ec2:DescribeVpcEndpoints'],
  DescribeVpcPeeringConnections: ['ec2:DescribeVpcPeeringConnections'],
  DescribeTransitGateways: ['ec2:DescribeTransitGateways'],
  DescribeTransitGatewayAttachments: ['ec2:DescribeTransitGatewayAttachments'],
  
  // PrivateLink specific operations
  PrivateLink: [
    'ec2:DescribeVpcEndpointServices',
    'ec2:DescribeVpcEndpoints',
    'ec2:DescribeVpcEndpointServicePermissions',
    'ec2:DescribeVpcEndpointConnections',
    'ec2:DescribeVpcEndpointServiceConfigurations',
    'ec2:ModifyVpcEndpointServicePermissions'
  ],
  
  // General EC2 permissions
  EC2General: [
    'ec2:DescribeVpcs',
    'ec2:DescribeRegions', 
    'ec2:DescribeSubnets',
    'ec2:DescribeRouteTables',
    'ec2:DescribeInternetGateways',
    'ec2:DescribeSecurityGroups',
    'ec2:DescribeVpcEndpoints'
  ],
  
  // Specific feature sets
  VPCFullDetails: [
    'ec2:DescribeVpcs',
    'ec2:DescribeSubnets',
    'ec2:DescribeRouteTables',
    'ec2:DescribeInternetGateways',
    'ec2:DescribeNatGateways',
    'ec2:DescribeSecurityGroups',
    'ec2:DescribeNetworkAcls',
    'ec2:DescribeVpcEndpoints',
    'ec2:DescribeVpcPeeringConnections',
    'ec2:DescribeTransitGatewayAttachments'
  ]
};

// Helper function to parse error codes from AWS error messages
const getErrorCode = (error) => {
  if (error.name && error.name.includes('AccessDenied')) return 'AccessDenied';
  if (error.name && error.name.includes('UnauthorizedOperation')) return 'UnauthorizedOperation';
  if (error.Code) return error.Code;
  return 'Unknown';
};

// Get the API operation from the error message
const getApiOperation = (error) => {
  // Try to extract operation name from the error message
  const operationMatch = error.message.match(/(?:for )([A-Za-z]+)(?:\s|$)/);
  if (operationMatch && operationMatch[1]) {
    return operationMatch[1];
  }
  
  // Default operations based on error code
  if (error.name === 'UnauthorizedOperation') {
    return 'EC2General';
  }
  
  return null;
};

export const handleError = (error, operationHint = null) => {
  const errorCode = getErrorCode(error);
  const operation = operationHint || getApiOperation(error);
  
  console.error(chalk.red('Error:'), error.message);
  
  if (['AccessDenied', 'UnauthorizedOperation'].includes(errorCode)) {
    console.error(chalk.yellow('\nYou do not have sufficient permissions to perform this operation.'));
    
    const requiredPermissions = operation ? permissionMap[operation] : permissionMap.EC2General;
    
    if (requiredPermissions) {
      console.error(chalk.yellow('\nRequired IAM permissions:'));
      requiredPermissions.forEach(perm => console.error(chalk.cyan(`- ${perm}`)));
      
      // Provide IAM policy snippet
      console.error(chalk.yellow('\nExample IAM policy statement:'));
      const policyStatement = {
        Effect: 'Allow',
        Action: requiredPermissions,
        Resource: '*'
      };
      
      console.error(chalk.cyan(JSON.stringify(policyStatement, null, 2)));
    }
    
    if (error.message.includes('GovCloud')) {
      console.error(chalk.yellow('\nNOTE: For GovCloud regions, ensure your credentials have access to the GovCloud partition.'));
    }
  }
};

// Helper for handling errors in vpc-details command
export const handleVpcDetailsError = (error) => {
  return handleError(error, 'VPCFullDetails');
};
