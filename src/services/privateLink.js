import { 
  EC2Client, 
  DescribeVpcEndpointServicesCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcEndpointServicePermissionsCommand,
  DescribeVpcEndpointConnectionsCommand,
  DescribeVpcEndpointServiceConfigurationsCommand,
  ModifyVpcEndpointServicePermissionsCommand
} from '@aws-sdk/client-ec2';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createEC2Client } from '../aws/client.js';
import { handleError } from '../utils/errorHandler.js';

/**
 * List all VPC Endpoint Services in the specified region
 */
export const listEndpointServices = async (region, options = {}) => {
  try {
    const client = createEC2Client(region);
    console.log(chalk.cyan(`\nFetching VPC Endpoint Services in ${region}...`));
    
    const command = new DescribeVpcEndpointServicesCommand({
      ...options
    });
    
    const response = await client.send(command);
    
    if (!response.ServiceDetails || response.ServiceDetails.length === 0) {
      console.log(chalk.yellow('No VPC Endpoint Services found.'));
      return [];
    }
    
    // Create a more focused table with key information
    const table = new Table({
      head: [
        'Service ID', 
        'Type', 
        'Owner', 
        'Acceptance\nRequired', 
        'AZs'
      ],
      style: { head: ['cyan'] },
      colWidths: [25, 12, 15, 12, 15],
      wordWrap: true
    });
    
    for (const service of response.ServiceDetails) {
      table.push([
        service.ServiceId || '-',
        service.ServiceType?.[0]?.ServiceType || '-',
        service.Owner === process.env.AWS_ACCOUNT_ID ? 'Self' : (service.Owner || '-'),
        service.AcceptanceRequired ? chalk.yellow('Yes') : 'No',
        (service.AvailabilityZones || []).join('\n') || '-'
      ]);
    }
    
    console.log(table.toString());
    console.log(chalk.green(`Total VPC Endpoint Services: ${response.ServiceDetails.length}`));
    
    // Display full service information for each service
    console.log(chalk.cyan.bold('\nDetailed Service Information:'));
    
    for (const service of response.ServiceDetails) {
      console.log(chalk.yellow.bold(`\n${service.ServiceId}`));
      console.log(chalk.white.bold('Service Name: ') + service.ServiceName);
      console.log(chalk.white.bold('Owner: ') + (service.Owner || '-'));
      console.log(chalk.white.bold('Acceptance Required: ') + (service.AcceptanceRequired ? chalk.yellow('Yes') : 'No'));
      console.log(chalk.white.bold('Available in AZs: ') + (service.AvailabilityZones || []).join(', '));
      
      if (service.BaseEndpointDnsNames && service.BaseEndpointDnsNames.length > 0) {
        console.log(chalk.white.bold('Base DNS Names:'));
        service.BaseEndpointDnsNames.forEach(dns => {
          console.log(`  - ${dns}`);
        });
      }
      
      if (service.PrivateDnsName) {
        console.log(chalk.white.bold('Private DNS Name: ') + service.PrivateDnsName);
      }
      
      if (service.SupportedIpAddressTypes && service.SupportedIpAddressTypes.length > 0) {
        console.log(chalk.white.bold('Supported IP Address Types: ') + service.SupportedIpAddressTypes.join(', '));
      }
      
      if (service.ServiceType && service.ServiceType.length > 0) {
        console.log(chalk.white.bold('Service Type: ') + service.ServiceType.map(t => t.ServiceType).join(', '));
      }
      
      if (service.Tags && service.Tags.length > 0) {
        console.log(chalk.white.bold('Tags:'));
        service.Tags.forEach(tag => {
          console.log(`  - ${tag.Key}: ${tag.Value}`);
        });
      }
    }
    
    return response.ServiceDetails;
  } catch (error) {
    handleError(error, 'PrivateLink');
    return [];
  }
};

/**
 * Get detailed information about a specific VPC Endpoint Service
 */
export const getEndpointServiceDetails = async (region, serviceId) => {
  try {
    const client = createEC2Client(region);
    console.log(chalk.cyan(`\nFetching details for VPC Endpoint Service ${serviceId}...`));
    
    // Get basic service details
    const serviceCmd = new DescribeVpcEndpointServicesCommand({
      ServiceIds: [serviceId]
    });
    
    // Get permissions (allowed principals)
    const permissionsCmd = new DescribeVpcEndpointServicePermissionsCommand({
      ServiceId: serviceId
    });
    
    // Get connections to this service
    const connectionsCmd = new DescribeVpcEndpointConnectionsCommand({
      Filters: [{ Name: 'service-id', Values: [serviceId] }]
    });
    
    // Execute all commands in parallel
    const [serviceResponse, permissionsResponse, connectionsResponse] = await Promise.all([
      client.send(serviceCmd),
      client.send(permissionsCmd),
      client.send(connectionsCmd)
    ]);
    
    if (!serviceResponse.ServiceDetails || serviceResponse.ServiceDetails.length === 0) {
      console.log(chalk.yellow(`No service found with ID: ${serviceId}`));
      return null;
    }
    
    const service = serviceResponse.ServiceDetails[0];
    
    // Display basic info
    console.log(chalk.cyan.bold('\nEndpoint Service Details:'));
    console.log(chalk.white.bold('Service ID: ') + service.ServiceId);
    console.log(chalk.white.bold('Service Name: ') + service.ServiceName);
    console.log(chalk.white.bold('Owner: ') + (service.Owner || '-'));
    console.log(chalk.white.bold('Service Type: ') + (service.ServiceType?.[0]?.ServiceType || '-'));
    console.log(chalk.white.bold('Acceptance Required: ') + (service.AcceptanceRequired ? chalk.yellow('Yes') : 'No'));
    console.log(chalk.white.bold('Availability Zones: ') + (service.AvailabilityZones || []).join(', '));
    console.log(chalk.white.bold('Base DNS Names: ') + (service.BaseEndpointDnsNames || []).join(', '));
    console.log(chalk.white.bold('Private DNS Name: ') + (service.PrivateDnsName || 'None'));
    console.log(chalk.white.bold('Supported IP Address Types: ') + (service.SupportedIpAddressTypes || []).join(', '));
    
    if (service.ManagesVpcEndpoints !== undefined) {
      console.log(chalk.white.bold('Manages VPC Endpoints: ') + (service.ManagesVpcEndpoints ? 'Yes' : 'No'));
    }
    
    if (service.Tags && service.Tags.length > 0) {
      console.log(chalk.white.bold('\nTags:'));
      for (const tag of service.Tags) {
        console.log(`  ${tag.Key}: ${tag.Value}`);
      }
    }
    
    // Display permissions
    console.log(chalk.cyan.bold('\nAllowed Principals:'));
    if (permissionsResponse.AllowedPrincipals && permissionsResponse.AllowedPrincipals.length > 0) {
      const principalsTable = new Table({
        head: ['Principal', 'Principal Type'],
        style: { head: ['cyan'] },
        colWidths: [60, 20],
        wordWrap: true
      });
      
      for (const principal of permissionsResponse.AllowedPrincipals) {
        principalsTable.push([
          principal.Principal || '-',
          principal.PrincipalType || '-'
        ]);
      }
      
      console.log(principalsTable.toString());
    } else {
      console.log(chalk.yellow('No principals are allowed to connect to this service.'));
    }
    
    // Display connections
    console.log(chalk.cyan.bold('\nEndpoint Connections:'));
    if (connectionsResponse.VpcEndpointConnections && connectionsResponse.VpcEndpointConnections.length > 0) {
      const connectionsTable = new Table({
        head: ['Endpoint ID', 'VPC ID', 'Owner', 'State', 'Creation Timestamp'],
        style: { head: ['cyan'] },
        colWidths: [25, 25, 25, 15, 25],
        wordWrap: true
      });
      
      for (const connection of connectionsResponse.VpcEndpointConnections) {
        connectionsTable.push([
          connection.VpcEndpointId || '-',
          connection.VpcId || '-',
          connection.OwnerId || '-',
          getStateWithColor(connection.VpcEndpointState),
          connection.CreationTimestamp?.toLocaleString() || '-'
        ]);
      }
      
      console.log(connectionsTable.toString());
      
      // Show detailed connection information
      console.log(chalk.cyan.bold('\nConnection Details:'));
      
      for (const connection of connectionsResponse.VpcEndpointConnections) {
        console.log(chalk.yellow.bold(`\n${connection.VpcEndpointId} Connection:`));
        console.log(chalk.white.bold('VPC ID: ') + connection.VpcId);
        console.log(chalk.white.bold('Owner: ') + connection.OwnerId);
        console.log(chalk.white.bold('State: ') + getStateWithColor(connection.VpcEndpointState));
        console.log(chalk.white.bold('Created: ') + (connection.CreationTimestamp?.toLocaleString() || '-'));
        
        if (connection.DnsEntries && connection.DnsEntries.length > 0) {
          console.log(chalk.white.bold('DNS Entries:'));
          for (const dns of connection.DnsEntries) {
            console.log(`  - ${dns.DnsName} (${dns.HostedZoneId})`);
          }
        }
        
        if (connection.GatewayLoadBalancerEndpointId) {
          console.log(chalk.white.bold('GWLB Endpoint ID: ') + connection.GatewayLoadBalancerEndpointId);
        }
        
        if (connection.NetworkLoadBalancerArns && connection.NetworkLoadBalancerArns.length > 0) {
          console.log(chalk.white.bold('NLB ARNs:'));
          for (const arn of connection.NetworkLoadBalancerArns) {
            console.log(`  - ${arn}`);
          }
        }
        
        if (connection.Tags && connection.Tags.length > 0) {
          console.log(chalk.white.bold('Tags:'));
          for (const tag of connection.Tags) {
            console.log(`  - ${tag.Key}: ${tag.Value}`);
          }
        }
      }
    } else {
      console.log(chalk.yellow('No active connections to this endpoint service.'));
    }
    
    return {
      service,
      permissions: permissionsResponse.AllowedPrincipals || [],
      connections: connectionsResponse.VpcEndpointConnections || []
    };
  } catch (error) {
    handleError(error, 'PrivateLink');
    return null;
  }
};

/**
 * List all VPC Endpoints in the specified region with filtering options
 */
export const listVpcEndpoints = async (region, options = {}) => {
  try {
    const client = createEC2Client(region);
    console.log(chalk.cyan(`\nFetching VPC Endpoints in ${region}...`));
    
    const filters = [];
    
    if (options.vpcId) {
      filters.push({ Name: 'vpc-id', Values: [options.vpcId] });
    }
    
    if (options.endpointType) {
      filters.push({ Name: 'vpc-endpoint-type', Values: [options.endpointType] });
    }
    
    const command = new DescribeVpcEndpointsCommand({
      Filters: filters.length > 0 ? filters : undefined
    });
    
    const response = await client.send(command);
    
    if (!response.VpcEndpoints || response.VpcEndpoints.length === 0) {
      console.log(chalk.yellow('No VPC Endpoints found.'));
      return [];
    }
    
    // Basic table with key information
    const table = new Table({
      head: [
        'Endpoint ID', 
        'VPC ID', 
        'Type', 
        'State', 
        'Service'
      ],
      style: { head: ['cyan'] },
      colWidths: [25, 25, 12, 12, 35],
      wordWrap: true
    });
    
    for (const endpoint of response.VpcEndpoints) {
      table.push([
        endpoint.VpcEndpointId || '-',
        endpoint.VpcId || '-',
        endpoint.VpcEndpointType || '-',
        getStateWithColor(endpoint.State),
        endpoint.ServiceName || '-'
      ]);
    }
    
    console.log(table.toString());
    console.log(chalk.green(`Total VPC Endpoints: ${response.VpcEndpoints.length}`));
    
    // Always display comprehensive details for each endpoint
    for (const endpoint of response.VpcEndpoints) {
      console.log(chalk.cyan.bold(`\n${endpoint.VpcEndpointId} Details:`));
      console.log(chalk.white.bold('Service Name: ') + endpoint.ServiceName);
      console.log(chalk.white.bold('VPC ID: ') + endpoint.VpcId);
      console.log(chalk.white.bold('Type: ') + endpoint.VpcEndpointType);
      console.log(chalk.white.bold('State: ') + getStateWithColor(endpoint.State));
      console.log(chalk.white.bold('Private DNS Enabled: ') + 
                  (endpoint.PrivateDnsEnabled ? chalk.green('Yes') : chalk.gray('No')));
      
      if (endpoint.PolicyDocument) {
        // Pretty print the policy document
        console.log(chalk.white.bold('\nPolicy Document:'));
        try {
          const policy = JSON.parse(endpoint.PolicyDocument);
          console.log(JSON.stringify(policy, null, 2));
        } catch (e) {
          console.log(endpoint.PolicyDocument);
        }
      }
      
      if (endpoint.SubnetIds && endpoint.SubnetIds.length > 0) {
        console.log(chalk.white.bold('\nSubnet IDs:'));
        for (const subnetId of endpoint.SubnetIds) {
          console.log(`  - ${subnetId}`);
        }
      }
      
      if (endpoint.RouteTableIds && endpoint.RouteTableIds.length > 0) {
        console.log(chalk.white.bold('\nRoute Table IDs:'));
        for (const rtbId of endpoint.RouteTableIds) {
          console.log(`  - ${rtbId}`);
        }
      }
      
      if (endpoint.Groups && endpoint.Groups.length > 0) {
        console.log(chalk.white.bold('\nSecurity Groups:'));
        for (const group of endpoint.Groups) {
          console.log(`  - ${group.GroupId} (${group.GroupName})`);
        }
      }
      
      if (endpoint.DnsEntries && endpoint.DnsEntries.length > 0) {
        console.log(chalk.white.bold('\nDNS Entries:'));
        for (const dns of endpoint.DnsEntries) {
          console.log(`  - ${dns.DnsName}`);
          console.log(`    Hosted Zone: ${dns.HostedZoneId}`);
        }
      }
      
      if (endpoint.NetworkInterfaceIds && endpoint.NetworkInterfaceIds.length > 0) {
        console.log(chalk.white.bold('\nNetwork Interfaces:'));
        for (const eni of endpoint.NetworkInterfaceIds) {
          console.log(`  - ${eni}`);
        }
      }

      if (endpoint.OwnerId) {
        console.log(chalk.white.bold('\nOwner ID: ') + endpoint.OwnerId);
      }
      
      if (endpoint.Tags && endpoint.Tags.length > 0) {
        console.log(chalk.white.bold('\nTags:'));
        for (const tag of endpoint.Tags) {
          console.log(`  - ${tag.Key}: ${tag.Value}`);
        }
      }
      
      console.log(chalk.gray('\n' + '-'.repeat(80)));
    }
    
    return response.VpcEndpoints;
  } catch (error) {
    handleError(error, 'PrivateLink');
    return [];
  }
};

/**
 * List your own VPC Endpoint Service configurations
 */
export const listOwnEndpointServices = async (region) => {
  try {
    const client = createEC2Client(region);
    console.log(chalk.cyan(`\nFetching your VPC Endpoint Service configurations in ${region}...`));
    
    const command = new DescribeVpcEndpointServiceConfigurationsCommand({});
    const response = await client.send(command);
    
    if (!response.ServiceConfigurations || response.ServiceConfigurations.length === 0) {
      console.log(chalk.yellow('You have no VPC Endpoint Service configurations.'));
      return [];
    }
    
    // Create a concise table for overview
    const table = new Table({
      head: [
        'Service ID', 
        'Acceptance\nRequired', 
        'Private DNS\nName',
        'Created'
      ],
      style: { head: ['cyan'] },
      colWidths: [25, 15, 30, 25],
      wordWrap: true
    });
    
    for (const config of response.ServiceConfigurations) {
      table.push([
        config.ServiceId || '-',
        config.AcceptanceRequired ? chalk.yellow('Yes') : 'No',
        config.PrivateDnsName || 'None',
        config.CreationTimestamp?.toLocaleString() || '-'
      ]);
    }
    
    console.log(table.toString());
    console.log(chalk.green(`Total service configurations: ${response.ServiceConfigurations.length}`));
    
    // Show detailed information for each service configuration including allowed principals
    console.log(chalk.cyan.bold('\nDetailed Service Configurations:'));
    
    for (const config of response.ServiceConfigurations) {
      console.log(chalk.yellow.bold(`\n${config.ServiceId} Configuration:`));
      console.log(chalk.white.bold('Service Name: ') + config.ServiceName);
      console.log(chalk.white.bold('Acceptance Required: ') + (config.AcceptanceRequired ? chalk.yellow('Yes') : 'No'));
      console.log(chalk.white.bold('Private DNS Name: ') + (config.PrivateDnsName || 'None'));
      console.log(chalk.white.bold('Created: ') + (config.CreationTimestamp?.toLocaleString() || '-'));
      console.log(chalk.white.bold('State: ') + getStateWithColor(config.ServiceState));
      
      if (config.AvailabilityZones && config.AvailabilityZones.length > 0) {
        console.log(chalk.white.bold('Availability Zones:'));
        for (const az of config.AvailabilityZones) {
          console.log(`  - ${az}`);
        }
      }
      
      if (config.NetworkLoadBalancerArns && config.NetworkLoadBalancerArns.length > 0) {
        console.log(chalk.white.bold('Network Load Balancers:'));
        for (const nlb of config.NetworkLoadBalancerArns) {
          console.log(`  - NLB: ${nlb}`);
        }
      }
      
      if (config.GatewayLoadBalancerArns && config.GatewayLoadBalancerArns.length > 0) {
        console.log(chalk.white.bold('Gateway Load Balancers:'));
        for (const gwlb of config.GatewayLoadBalancerArns) {
          console.log(`  - GWLB: ${gwlb}`);
        }
      }
      
      if (config.SupportedIpAddressTypes && config.SupportedIpAddressTypes.length > 0) {
        console.log(chalk.white.bold('Supported IP Address Types: ') + config.SupportedIpAddressTypes.join(', '));
      }
      
      if (config.Tags && config.Tags.length > 0) {
        console.log(chalk.white.bold('Tags:'));
        for (const tag of config.Tags) {
          console.log(`  - ${tag.Key}: ${tag.Value}`);
        }
      }
      
      // Fetch and display allowed principals for this service
      try {
        console.log(chalk.cyan.bold('\nAllowed Principals:'));
        const permissionsCmd = new DescribeVpcEndpointServicePermissionsCommand({
          ServiceId: config.ServiceId
        });
        
        const permissionsResponse = await client.send(permissionsCmd);
        
        if (permissionsResponse.AllowedPrincipals && permissionsResponse.AllowedPrincipals.length > 0) {
          const principalsTable = new Table({
            head: ['Principal', 'Principal Type'],
            style: { head: ['cyan'] },
            colWidths: [60, 20],
            wordWrap: true
          });
          
          for (const principal of permissionsResponse.AllowedPrincipals) {
            principalsTable.push([
              principal.Principal || '-',
              principal.PrincipalType || '-'
            ]);
          }
          
          console.log(principalsTable.toString());
        } else {
          console.log(chalk.yellow('  No principals are allowed to connect to this service.'));
        }
      } catch (permError) {
        console.log(chalk.red(`  Error fetching service permissions: ${permError.message}`));
      }
      
      // Fetch and display current connections to this service
      try {
        console.log(chalk.cyan.bold('\nCurrent Connections:'));
        const connectionsCmd = new DescribeVpcEndpointConnectionsCommand({
          Filters: [{ Name: 'service-id', Values: [config.ServiceId] }]
        });
        
        const connectionsResponse = await client.send(connectionsCmd);
        
        if (connectionsResponse.VpcEndpointConnections && connectionsResponse.VpcEndpointConnections.length > 0) {
          const connectionsTable = new Table({
            head: ['Endpoint ID', 'VPC ID', 'Owner', 'State'],
            style: { head: ['cyan'] },
            colWidths: [25, 25, 25, 15],
            wordWrap: true
          });
          
          for (const connection of connectionsResponse.VpcEndpointConnections) {
            connectionsTable.push([
              connection.VpcEndpointId || '-',
              connection.VpcId || '-',
              connection.OwnerId || '-',
              getStateWithColor(connection.VpcEndpointState)
            ]);
          }
          
          console.log(connectionsTable.toString());
        } else {
          console.log(chalk.yellow('  No active connections to this service.'));
        }
      } catch (connError) {
        console.log(chalk.red(`  Error fetching service connections: ${connError.message}`));
      }
      
      console.log(chalk.gray('\n' + '-'.repeat(80)));
    }
    
    return response.ServiceConfigurations;
  } catch (error) {
    handleError(error, 'PrivateLink');
    return [];
  }
};

/**
 * Modify permissions for a VPC Endpoint Service to allow or disallow principals
 */
export const modifyEndpointServicePermissions = async (region, serviceId, principal, action) => {
  try {
    const client = createEC2Client(region);
    console.log(chalk.cyan(`\nModifying permissions for VPC Endpoint Service ${serviceId}...`));
    
    const command = new ModifyVpcEndpointServicePermissionsCommand({
      ServiceId: serviceId,
      AddAllowedPrincipals: action === 'add' ? [principal] : undefined,
      RemoveAllowedPrincipals: action === 'remove' ? [principal] : undefined
    });
    
    await client.send(command);
    
    console.log(chalk.green(`Successfully ${action === 'add' ? 'added' : 'removed'} principal: ${principal}`));
    
    // Show the current permissions after modification
    return getEndpointServiceDetails(region, serviceId);
  } catch (error) {
    handleError(error, 'PrivateLink');
    return null;
  }
};

/**
 * Helper function to format state with color
 */
function getStateWithColor(state) {
  if (!state) return '-';
  
  switch (state.toLowerCase()) {
    case 'available':
      return chalk.green(state);
    case 'pending':
    case 'pending-acceptance':
      return chalk.yellow(state);
    case 'deleting':
    case 'deleted':
    case 'rejected':
    case 'failed':
      return chalk.red(state);
    default:
      return state;
  }
}

export default {
  listEndpointServices,
  getEndpointServiceDetails,
  listVpcEndpoints,
  listOwnEndpointServices,
  modifyEndpointServicePermissions
};
