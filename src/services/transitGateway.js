import { 
  DescribeTransitGatewaysCommand, 
  DescribeTransitGatewayAttachmentsCommand,
  DescribeTransitGatewayRouteTablesCommand,
  GetTransitGatewayRouteTableAssociationsCommand,
  GetTransitGatewayRouteTablePropagationsCommand,
  SearchTransitGatewayRoutesCommand
} from '@aws-sdk/client-ec2';

// Remove the incorrect import
// import * as ec2 from '@aws-sdk/client-ec2';
// const { DescribeTransitGatewayRoutesCommand } = ec2;

import { paginateCommand } from '../aws/pagination.js';
import chalk from 'chalk';

/**
 * List all Transit Gateways
 * @param {EC2Client} client - AWS EC2 client
 * @returns {Array} - List of Transit Gateways
 */
export const listTransitGateways = async (client) => {
  try {
    return await paginateCommand(client, DescribeTransitGatewaysCommand, {}, 'TransitGateways');
  } catch (error) {
    console.error(chalk.red('Error fetching transit gateways:'), error);
    throw error;
  }
};

/**
 * Get Transit Gateway attachments for a specific TGW
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} tgwId - Transit Gateway ID
 * @returns {Array} - List of Transit Gateway attachments
 */
export const getTransitGatewayAttachments = async (client, tgwId) => {
  try {
    const filters = [
      {
        Name: 'transit-gateway-id',
        Values: [tgwId],
      },
    ];
    
    return await paginateCommand(
      client, 
      DescribeTransitGatewayAttachmentsCommand, 
      { Filters: filters },
      'TransitGatewayAttachments'
    );
  } catch (error) {
    console.error(chalk.red(`Error fetching attachments for transit gateway ${tgwId}:`), error);
    throw error;
  }
};

export const getTransitGatewayAttachmentsByVPC = async (client, vpcId) => {
  try {
    const filters = [
      {
        Name: 'resource-id',
        Values: [vpcId],
      },
    ];
    const command = new DescribeTransitGatewayAttachmentsCommand({ Filters: filters });
    const response = await client.send(command);
    return response.TransitGatewayAttachments;
  } catch (error) {
    console.error(`Error fetching Transit Gateway attachments for VPC ${vpcId}:`, error);
    throw error;
  }
};

/**
 * List Transit Gateway Route Tables
 * @param {EC2Client} client - AWS EC2 client
 * @param {Object|string|null} options - Options for filtering
 * @param {string} options.tgwId - Optional Transit Gateway ID to filter by
 * @param {string[]} options.routeTableIds - Optional array of specific route table IDs
 * @returns {Array} - List of Transit Gateway route tables
 */
export const listTransitGatewayRouteTables = async (client, options = {}) => {
  try {
    const params = {};
    
    // Handle null options or string tgwId
    if (options === null || options === undefined) {
      // No filter - will return all route tables
    } else if (typeof options === 'string') {
      // For backward compatibility, string options is treated as tgwId
      if (options) {
        params.Filters = [
          {
            Name: 'transit-gateway-id',
            Values: [options],
          },
        ];
      }
    } else {
      // Normal object options
      const { tgwId, routeTableIds } = options;
      
      // Add filters if tgwId is provided
      if (tgwId) {
        params.Filters = [
          {
            Name: 'transit-gateway-id',
            Values: [tgwId],
          },
        ];
      }
      
      // Add specific route table IDs if provided
      if (routeTableIds && routeTableIds.length > 0) {
        params.TransitGatewayRouteTableIds = routeTableIds;
      }
    }
    
    return await paginateCommand(
      client,
      DescribeTransitGatewayRouteTablesCommand,
      params,
      'TransitGatewayRouteTables'
    );
  } catch (error) {
    console.error(chalk.red('Error fetching transit gateway route tables:'), error);
    throw error;
  }
};

/**
 * Search Transit Gateway Routes within a specific route table
 * @param {EC2Client} client - AWS EC2 client 
 * @param {string} routeTableId - Transit Gateway Route Table ID
 * @param {string} cidrFilter - Optional CIDR filter (e.g., "0.0.0.0/0")
 * @returns {Array} - List of matching routes
 */
export const searchTransitGatewayRoutes = async (client, routeTableId, cidrFilter = null) => {
  try {
    const params = {
      TransitGatewayRouteTableId: routeTableId,
      Filters: []
    };
    
    if (cidrFilter) {
      params.Filters.push({
        Name: 'route-search.exact-match',
        Values: [cidrFilter]
      });
    }
    
    const command = new SearchTransitGatewayRoutesCommand(params);
    const response = await client.send(command);
    return response.Routes || [];
  } catch (error) {
    console.error(chalk.red(`Error searching routes in table ${routeTableId}:`), error);
    throw error;
  }
};

/**
 * Get Transit Gateway Routes from a specific route table
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} routeTableId - Transit Gateway Route Table ID
 * @returns {Array} - List of routes
 */
export const getTransitGatewayRoutes = async (client, routeTableId) => {
  try {
    const params = {
      TransitGatewayRouteTableId: routeTableId,
      Filters: [{
        Name: 'route-search.subnet-of-match',
        Values: ['0.0.0.0/0']
      }]
    };
    
    const command = new SearchTransitGatewayRoutesCommand(params);
    const response = await client.send(command);
    
    return response.Routes || [];
  } catch (error) {
    console.error(chalk.red(`Error getting routes for table ${routeTableId}: ${error.message}`));
    return []; 
  }
};

/**
 * Display Transit Gateway Routes in a human-readable format
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} routeTableId - Transit Gateway Route Table ID
 */
export const displayTransitGatewayRoutes = async (client, routeTableId) => {
  console.log(chalk.bold(`\n=== Routes for Transit Gateway Route Table ${routeTableId} ===`));
  
  try {
    const routes = await getTransitGatewayRoutes(client, routeTableId);
    
    if (!routes || routes.length === 0) {
      console.log(chalk.yellow('No routes found in this route table'));
      return;
    }
    
    // Display route information in a table-like format
    console.log(`\n${chalk.cyan('Destination')}         ${chalk.cyan('Type')}         ${chalk.cyan('Target')}                 ${chalk.cyan('State')}\n`);
    
    routes.forEach(route => {
      const destination = route.DestinationCidrBlock?.padEnd(18) || 'N/A'.padEnd(18);
      const type = route.Type?.padEnd(13) || 'N/A'.padEnd(13);
      
      let target = 'blackhole';
      if (route.TransitGatewayAttachments && route.TransitGatewayAttachments.length > 0) {
        const attachment = route.TransitGatewayAttachments[0];
        target = attachment.ResourceId || 'Unknown';
        if (attachment.ResourceType) {
          target += ` (${attachment.ResourceType})`;
        }
      }
      
      const state = route.State || 'unknown';
      const stateColor = state === 'active' ? chalk.green : chalk.yellow;
      
      console.log(`${destination} ${type} ${target.padEnd(22)} ${stateColor(state)}`);
    });
  } catch (error) {
    console.error(chalk.red(`Error displaying routes: ${error.message}`));
  }
};

/**
 * Display Transit Gateway Route Tables in a human-readable format
 * @param {Array} routeTables - Array of Transit Gateway route tables
 * @param {EC2Client} client - AWS EC2 client for fetching additional data
 * @param {boolean} showDetails - Whether to show details like associations and propagations
 */
export const displayTransitGatewayRouteTables = async (routeTables, client, showDetails = false) => {
  if (!routeTables || routeTables.length === 0) {
    console.log(chalk.yellow('No Transit Gateway route tables found'));
    return;
  }
  
  // Display route tables in tabular format by default
  displayTransitGatewayRouteTablesAsTable(routeTables);
  
  // If detailed view is requested, also show the detailed information
  if (showDetails) {
    console.log(chalk.bold('\n=== Detailed Transit Gateway Route Table Information ==='));
    
    for (const table of routeTables) {
      console.log(`\n${chalk.green('Route Table ID:')} ${table.TransitGatewayRouteTableId}`);
      console.log(`${chalk.green('TGW ID:')} ${table.TransitGatewayId}`);
      console.log(`${chalk.green('State:')} ${table.State}`);
      console.log(`${chalk.green('Default Association:')} ${table.DefaultAssociationRouteTable ? 'Yes' : 'No'}`);
      console.log(`${chalk.green('Default Propagation:')} ${table.DefaultPropagationRouteTable ? 'Yes' : 'No'}`);
      
      if (table.Tags && table.Tags.length > 0) {
        console.log(chalk.green('Tags:'));
        table.Tags.forEach(tag => {
          console.log(`  ${tag.Key}: ${tag.Value}`);
        });
      }
      
      if (client) {
        try {
          // Show route table associations
          const associations = await getTransitGatewayRouteTableAssociations(client, table.TransitGatewayRouteTableId);
          if (associations && associations.length > 0) {
            console.log(chalk.cyan('\nAssociations:'));
            associations.forEach(assoc => {
              console.log(`  - ${assoc.ResourceId} (${assoc.ResourceType}) - ${assoc.State}`);
            });
          } else {
            console.log(chalk.cyan('\nAssociations: None'));
          }
          
          // Show route table propagations
          const propagations = await getTransitGatewayRouteTablePropagations(client, table.TransitGatewayRouteTableId);
          if (propagations && propagations.length > 0) {
            console.log(chalk.cyan('\nPropagations:'));
            propagations.forEach(prop => {
              console.log(`  - ${prop.ResourceId} (${prop.ResourceType}) - ${prop.State}`);
            });
          } else {
            console.log(chalk.cyan('\nPropagations: None'));
          }
          
          // Show routes preview (limited to avoid API throttling)
          try {
            console.log(chalk.cyan('\nRoutes (sample):'));
            const routes = await searchTransitGatewayRoutes(client, table.TransitGatewayRouteTableId);
            if (routes && routes.length > 0) {
              routes.slice(0, 5).forEach(route => {
                console.log(`  - ${route.DestinationCidrBlock} → ${route.TransitGatewayAttachments?.[0]?.ResourceId || 'blackhole'}`);
              });
              if (routes.length > 5) {
                console.log(`  ... and ${routes.length - 5} more routes`);
              }
            } else {
              console.log('  No routes found');
            }
          } catch (routeError) {
            console.log('  Unable to fetch routes');
          }
        } catch (error) {
          console.error(chalk.red('Error fetching route table details:'), error);
        }
      }
      
      console.log(chalk.gray('----------------------------------------'));
    }
  }
};

/**
 * Get Transit Gateway Route Table Associations
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} routeTableId - Transit Gateway Route Table ID
 * @returns {Array} - List of associations
 */
export const getTransitGatewayRouteTableAssociations = async (client, routeTableId) => {
  try {
    return await paginateCommand(
      client,
      GetTransitGatewayRouteTableAssociationsCommand,
      { TransitGatewayRouteTableId: routeTableId },
      'Associations'
    );
  } catch (error) {
    console.error(chalk.red(`Error fetching associations for route table ${routeTableId}:`), error);
    throw error;
  }
};

/**
 * Get Transit Gateway Route Table Propagations
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} routeTableId - Transit Gateway Route Table ID
 * @returns {Array} - List of propagations
 */
export const getTransitGatewayRouteTablePropagations = async (client, routeTableId) => {
  try {
    return await paginateCommand(
      client,
      GetTransitGatewayRouteTablePropagationsCommand,
      { TransitGatewayRouteTableId: routeTableId },
      'TransitGatewayRouteTablePropagations'
    );
  } catch (error) {
    console.error(chalk.red(`Error fetching propagations for route table ${routeTableId}:`), error);
    throw error;
  }
};

/**
 * Display Transit Gateway Route Tables in a tabular format
 * @param {Array} routeTables - Array of Transit Gateway route tables
 */
export const displayTransitGatewayRouteTablesAsTable = (routeTables) => {
  if (!routeTables || routeTables.length === 0) {
    console.log(chalk.yellow('No Transit Gateway route tables found'));
    return;
  }
  
  console.log(chalk.bold('\n=== Transit Gateway Route Tables ===\n'));
  
  // Define column headers and widths
  const headers = {
    id: 'Route Table ID',
    tgwId: 'TGW ID',
    state: 'State',
    name: 'Name',
    defaultAssoc: 'Default Assoc',
    defaultProp: 'Default Prop'
  };
  
  const columnWidths = {
    id: 24,
    tgwId: 24,
    state: 12,
    name: 20,
    defaultAssoc: 13,
    defaultProp: 13
  };
  
  // Print headers
  console.log(
    chalk.cyan(headers.id.padEnd(columnWidths.id)) +
    chalk.cyan(headers.tgwId.padEnd(columnWidths.tgwId)) +
    chalk.cyan(headers.state.padEnd(columnWidths.state)) +
    chalk.cyan(headers.name.padEnd(columnWidths.name)) +
    chalk.cyan(headers.defaultAssoc.padEnd(columnWidths.defaultAssoc)) +
    chalk.cyan(headers.defaultProp)
  );
  
  // Print separator
  console.log(
    '─'.repeat(columnWidths.id) +
    '─'.repeat(columnWidths.tgwId) +
    '─'.repeat(columnWidths.state) +
    '─'.repeat(columnWidths.name) +
    '─'.repeat(columnWidths.defaultAssoc) +
    '─'.repeat(columnWidths.defaultProp)
  );
  
  // Print rows
  routeTables.forEach(table => {
    // Extract name from tags if available
    let name = '';
    if (table.Tags && table.Tags.length > 0) {
      const nameTag = table.Tags.find(tag => tag.Key === 'Name');
      if (nameTag) {
        name = nameTag.Value;
      }
    }
    
    // Determine state color
    const stateColor = table.State === 'available' ? chalk.green : chalk.yellow;
    
    console.log(
      table.TransitGatewayRouteTableId.padEnd(columnWidths.id) +
      table.TransitGatewayId.padEnd(columnWidths.tgwId) +
      stateColor(table.State.padEnd(columnWidths.state)) +
      name.substring(0, columnWidths.name - 3).padEnd(columnWidths.name) +
      (table.DefaultAssociationRouteTable ? chalk.green('Yes') : chalk.red('No')).padEnd(columnWidths.defaultAssoc) +
      (table.DefaultPropagationRouteTable ? chalk.green('Yes') : chalk.red('No'))
    );
  });
  
  console.log(chalk.cyan(`\nTotal: ${routeTables.length} route tables`));
};

/**
 * Show all Transit Gateway Route Tables and their Routes
 * @param {EC2Client} client - AWS EC2 client
 */
export const showAllTransitGatewayRoutes = async (client) => {
  try {
    // First get all TGW route tables
    const routeTables = await listTransitGatewayRouteTables(client);
    
    if (!routeTables || routeTables.length === 0) {
      console.log(chalk.yellow('No Transit Gateway route tables found'));
      return;
    }
    
    // Display route tables in tabular format first for an overview
    displayTransitGatewayRouteTablesAsTable(routeTables);
    
    console.log(chalk.bold(`\nShowing detailed routes for ${routeTables.length} Transit Gateway route tables\n`));
    
    // For each route table, display its routes
    for (const table of routeTables) {
      console.log(chalk.green(`\n=== Route Table: ${table.TransitGatewayRouteTableId} ===`));
      if (table.Tags && table.Tags.length > 0) {
        const nameTag = table.Tags.find(tag => tag.Key === 'Name');
        if (nameTag) {
          console.log(chalk.green(`Name: ${nameTag.Value}`));
        }
      }
      
      // Display routes for this table
      await displayTransitGatewayRoutes(client, table.TransitGatewayRouteTableId);
      
      console.log(chalk.gray('\n----------------------------------------'));
    }
  } catch (error) {
    console.error(chalk.red('Error displaying Transit Gateway routes:'), error);
  }
};

/**
 * Simple function to just get and display TGW routes
 * @param {EC2Client} client - AWS EC2 client
 * @param {string} routeTableId - Transit Gateway Route Table ID 
 */
export const showRoutes = async (client, routeTableId) => {
  try {
    const params = {
      TransitGatewayRouteTableId: routeTableId,
      Filters: [{
        Name: 'route-search.subnet-of-match',
        Values: ['0.0.0.0/0']
      }]
    };
    
    const command = new SearchTransitGatewayRoutesCommand(params);
    const response = await client.send(command);
    
    if (response.Routes && response.Routes.length > 0) {
      console.log(chalk.cyan('DESTINATION          TYPE           TARGET                      STATE'));
      console.log(chalk.cyan('----------------------------------------------------------------'));
      
      response.Routes.forEach(route => {
        const destination = route.DestinationCidrBlock?.padEnd(18) || 'N/A'.padEnd(18);
        const type = route.Type?.padEnd(13) || 'N/A'.padEnd(13); 
        
        let target = 'blackhole';
        if (route.TransitGatewayAttachments && route.TransitGatewayAttachments.length > 0) {
          const attach = route.TransitGatewayAttachments[0];
          target = attach.ResourceId || 'Unknown';
          if (attach.ResourceType) target += ` (${attach.ResourceType})`;
        }
        
        const state = route.State || 'unknown';
        const stateColor = state === 'active' ? chalk.green : chalk.yellow;
        
        console.log(`${destination} ${type} ${target.padEnd(25)} ${stateColor(state)}`);
      });
      
      console.log(chalk.cyan('\nTotal routes: ') + chalk.bold(response.Routes.length));
    } else {
      console.log(chalk.yellow('No routes found in this route table'));
    }
  } catch (error) {
    console.error(chalk.red(`Error retrieving routes: ${error.message}`));
  }
};

/**
 * Get and display Transit Gateway Route Tables in a tabular format
 * This function is specifically for CLI commands to use 
 * @param {EC2Client} client - AWS EC2 client
 * @param {string|null} tgwId - Optional Transit Gateway ID to filter by
 * @returns {Array} - The route tables that were fetched and displayed
 */
export const getAndDisplayTransitGatewayRouteTables = async (client, tgwId = null) => {
  try {
    // Get route tables, filtered by tgwId if provided
    const routeTables = await listTransitGatewayRouteTables(client, tgwId ? { tgwId } : null);
    
    if (!routeTables || routeTables.length === 0) {
      console.log(chalk.yellow(`No Transit Gateway route tables found${tgwId ? ` for ${tgwId}` : ''}`));
      return [];
    }
    
    // Display in tabular format
    displayTransitGatewayRouteTablesAsTable(routeTables);
    
    return routeTables;
  } catch (error) {
    console.error(chalk.red('Error fetching and displaying transit gateway route tables:'), error);
    throw error;
  }
};
