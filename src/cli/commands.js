import fs from 'fs/promises';
import path from 'path';
import Table from 'cli-table3';
import chalk from 'chalk';
import { createEC2Client, getAllRegions, getGovCloudRegions } from '../aws/client.js';
import { listVPCs, getVPCDetails, getVPCFullDetails } from '../services/vpc.js';
import { listSubnets, getSubnetsByVPC } from '../services/subnet.js';
import { listRouteTables, getRouteTablesByVPC } from '../services/routeTable.js';
import { 
  listTransitGateways, 
  getTransitGatewayAttachments, 
  getTransitGatewayAttachmentsByVPC,
  listTransitGatewayRouteTables,
  getTransitGatewayRoutes,
  getTransitGatewayRouteTableAssociations,
  getTransitGatewayRouteTablePropagations,
  showRoutes,
  getAndDisplayTransitGatewayRouteTables
} from '../services/transitGateway.js';
import { listEndpoints, getEndpointsByVPC } from '../services/endpoint.js';
import {
  listEndpointServices,
  getEndpointServiceDetails,
  listVpcEndpoints,
  listOwnEndpointServices,
  modifyEndpointServicePermissions
} from '../services/privateLink.js';
import { handleError, handleVpcDetailsError } from '../utils/errorHandler.js';
import { 
  takeRegionNetworkSnapshot, 
  takeAllRegionsNetworkSnapshot, 
  compareNetworkSnapshots, 
  listNetworkSnapshots
} from '../services/networkSnapshot.js';
import { loadSnapshot, SNAPSHOTS_DIR } from '../utils/snapshot.js';
import { 
  configureCredentialsInteractive,
  loadCredentials,
  verifyCredentialsFile
} from '../services/credentials.js';

// Helper function to create tables
const createTable = (headers) => {
  return new Table({
    head: headers.map(h => chalk.cyan(h)),
    chars: {
      'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
      'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
      'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
      'right': '║', 'right-mid': '╢', 'middle': '│'
    }
  });
};

async function verifyCredentialsConfig() {
  const result = await verifyCredentialsFile();
  if (!result) {
    console.log(chalk.yellow('Suggestions:'));
    console.log(chalk.yellow('1. Run "cloud-connect configure-credentials" to set up credentials'));
    console.log(chalk.yellow('2. Check if ~/.cloud-connect directory exists and is writable'));
    console.log(chalk.yellow('3. Check for any error messages during credential configuration'));
  }
}

export const commands = {
  // VPC commands
  async listVPCs(region, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      const vpcs = await listVPCs(client);
      
      const table = createTable(['VPC ID', 'CIDR Block', 'State', 'Default', 'Tags']);
      
      vpcs.forEach(vpc => {
        const tags = vpc.Tags ? vpc.Tags.map(tag => `${tag.Key}: ${tag.Value}`).join('\n') : '';
        table.push([
          vpc.VpcId,
          vpc.CidrBlock,
          vpc.State,
          vpc.IsDefault ? 'Yes' : 'No',
          tags
        ]);
      });
      
      console.log(chalk.green.bold('\nAWS VPCs:'));
      console.log(table.toString());
    } catch (error) {
      handleError(error, 'DescribeVpcs');
    }
  },
  
  // New command to list VPCs across all regions
  async listAllRegionVPCs(isGovCloud = false) {
    try {
      console.log(chalk.yellow('Fetching regions...'));
      // Get appropriate regions based on whether this is GovCloud or not
      let regions;
      if (isGovCloud) {
        regions = await getGovCloudRegions();
        console.log(chalk.green(`Found ${regions.length} GovCloud regions`));
      } else {
        regions = await getAllRegions(isGovCloud);
        console.log(chalk.green(`Found ${regions.length} regions`));
      }
      
      const allRegionsTable = createTable(['Region', 'VPC Count']);
      const results = [];

      for (const region of regions) {
        try {
          process.stdout.write(chalk.yellow(`Fetching VPCs in ${region}... `));
          const client = createEC2Client(region);
          const vpcs = await listVPCs(client);
          process.stdout.write(chalk.green(`Found ${vpcs.length} VPCs\n`));
          
          allRegionsTable.push([region, vpcs.length]);
          
          if (vpcs.length > 0) {
            results.push({
              region,
              vpcs
            });
          }
        } catch (error) {
          process.stdout.write(chalk.red(`Error: ${error.message}\n`));
        }
      }
      
      console.log(chalk.green.bold('\nVPC Count by Region:'));
      console.log(allRegionsTable.toString());
      
      // Display VPC details for each region with VPCs
      for (const result of results) {
        console.log(chalk.green.bold(`\nVPCs in ${result.region}:`));
        
        const table = createTable(['VPC ID', 'CIDR Block', 'State', 'Default', 'Tags']);
        
        result.vpcs.forEach(vpc => {
          const tags = vpc.Tags ? vpc.Tags.map(tag => `${tag.Key}: ${tag.Value}`).join('\n') : '';
          table.push([
            vpc.VpcId,
            vpc.CidrBlock,
            vpc.State,
            vpc.IsDefault ? 'Yes' : 'No',
            tags
          ]);
        });
        
        console.log(table.toString());
      }
    } catch (error) {
      handleError(error, 'DescribeRegions');
    }
  },
  
  // Subnet commands
  async listSubnets(region, vpcId, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      let subnets;
      
      if (vpcId) {
        subnets = await getSubnetsByVPC(client, vpcId);
        console.log(chalk.green.bold(`\nSubnets for VPC ${vpcId}:`));
      } else {
        subnets = await listSubnets(client);
        console.log(chalk.green.bold('\nAll AWS Subnets:'));
      }
      
      const table = createTable(['Subnet ID', 'VPC ID', 'CIDR Block', 'AZ', 'State', 'Public']);
      
      subnets.forEach(subnet => {
        table.push([
          subnet.SubnetId,
          subnet.VpcId,
          subnet.CidrBlock,
          subnet.AvailabilityZone,
          subnet.State,
          subnet.MapPublicIpOnLaunch ? 'Yes' : 'No'
        ]);
      });
      
      console.log(table.toString());
    } catch (error) {
      handleError(error, 'DescribeSubnets');
    }
  },
  
  // Route table commands
  async listRouteTables(region, vpcId, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      let routeTables;
      
      if (vpcId) {
        routeTables = await getRouteTablesByVPC(client, vpcId);
        console.log(chalk.green.bold(`\nRoute Tables for VPC ${vpcId}:`));
      } else {
        routeTables = await listRouteTables(client);
        console.log(chalk.green.bold('\nAll AWS Route Tables:'));
      }
      
      routeTables.forEach(rt => {
        console.log(chalk.yellow(`\nRoute Table: ${rt.RouteTableId} (VPC: ${rt.VpcId})`));
        
        // Show associations
        const associationTable = createTable(['Association ID', 'Type', 'ID', 'Main']);
        rt.Associations.forEach(assoc => {
          let type = 'Unknown';
          let id = '';
          
          if (assoc.SubnetId) {
            type = 'Subnet';
            id = assoc.SubnetId;
          } else if (assoc.GatewayId) {
            type = 'Gateway';
            id = assoc.GatewayId;
          }
          
          associationTable.push([
            assoc.RouteTableAssociationId || 'N/A',
            type,
            id,
            assoc.Main ? 'Yes' : 'No'
          ]);
        });
        
        console.log(chalk.blue('\nAssociations:'));
        console.log(associationTable.toString());
        
        // Show routes
        const routesTable = createTable(['Destination', 'Target', 'Status', 'Origin']);
        rt.Routes.forEach(route => {
          let target = '';
          if (route.GatewayId) target = `Gateway: ${route.GatewayId}`;
          else if (route.NatGatewayId) target = `NAT: ${route.NatGatewayId}`;
          else if (route.TransitGatewayId) target = `TGW: ${route.TransitGatewayId}`;
          else if (route.VpcPeeringConnectionId) target = `Peering: ${route.VpcPeeringConnectionId}`;
          else if (route.NetworkInterfaceId) target = `ENI: ${route.NetworkInterfaceId}`;
          else target = 'Local';
          
          routesTable.push([
            route.DestinationCidrBlock || route.DestinationPrefixListId || 'N/A',
            target,
            route.State || 'N/A',
            route.Origin || 'N/A'
          ]);
        });
        
        console.log(chalk.blue('\nRoutes:'));
        console.log(routesTable.toString());
      });
    } catch (error) {
      handleError(error, 'DescribeRouteTables');
    }
  },
  
  // Transit Gateway commands
  async listTransitGateways(region, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      const transitGateways = await listTransitGateways(client);
      
      console.log(chalk.green.bold('\nAWS Transit Gateways:'));
      
      const table = createTable(['TGW ID', 'Description', 'State', 'Owner ID']);
      
      transitGateways.forEach(tgw => {
        table.push([
          tgw.TransitGatewayId,
          tgw.Description || 'N/A',
          tgw.State,
          tgw.OwnerId
        ]);
      });
      
      console.log(table.toString());
    } catch (error) {
      handleError(error, 'DescribeTransitGateways');
    }
  },
  
  async listTGWAttachments(region, tgwId, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      
      // If no specific TGW ID was provided, get all transit gateways and their attachments
      if (!tgwId) {
        const transitGateways = await listTransitGateways(client);
        console.log(chalk.green.bold(`\nTransit Gateway Attachments in ${region}:`));
        
        if (transitGateways.length === 0) {
          console.log(chalk.yellow('No Transit Gateways found in this region.'));
          return;
        }
        
        // Process each transit gateway
        for (const tgw of transitGateways) {
          const attachments = await getTransitGatewayAttachments(client, tgw.TransitGatewayId);
          
          // Get TGW name from tags if available
          const tgwName = tgw.Tags?.find(tag => tag.Key === 'Name')?.Value || 'N/A';
          
          console.log(chalk.yellow(`\n🔄 Transit Gateway: ${tgw.TransitGatewayId} ${tgwName !== 'N/A' ? `(${tgwName})` : ''}`));
          
          if (attachments.length === 0) {
            console.log(chalk.gray('  No attachments found for this Transit Gateway'));
            continue;
          }
          
          const table = createTable(['Attachment ID', 'Resource Type', 'Resource ID', 'State']);
          
          attachments.forEach(attachment => {
            table.push([
              attachment.TransitGatewayAttachmentId,
              attachment.ResourceType,
              attachment.ResourceId,
              attachment.State
            ]);
          });
          
          console.log(table.toString());
        }
      } else {
        // Original functionality - show attachments for a specific TGW
        const attachments = await getTransitGatewayAttachments(client, tgwId);
        
        console.log(chalk.green.bold(`\nTransit Gateway Attachments for ${tgwId}:`));
        
        const table = createTable(['Attachment ID', 'Resource Type', 'Resource ID', 'State']);
        
        attachments.forEach(attachment => {
          table.push([
            attachment.TransitGatewayAttachmentId,
            attachment.ResourceType,
            attachment.ResourceId,
            attachment.State
          ]);
        });
        
        console.log(table.toString());
      }
    } catch (error) {
      handleError(error, 'DescribeTransitGatewayAttachments');
    }
  },

  async listTGWRouteTables(region, tgwId, isGovCloud = false, options = {}) {
    try {
      const client = createEC2Client(region, isGovCloud);
      
      // Get and display route tables in tabular format
      const routeTables = await getAndDisplayTransitGatewayRouteTables(client, tgwId);
      
      if (routeTables.length === 0) {
        return;
      }
      
      // If detailed view is desired, continue with showing details for each route table
      console.log(chalk.bold(`\nShowing detailed route information:`));
      
      for (const routeTable of routeTables) {
        // Get the TGW name if available
        const tgwName = routeTable.Tags?.find(tag => tag.Key === 'Name')?.Value || 'N/A';
          
        console.log(chalk.yellow(`\n🔄 Route Table: ${routeTable.TransitGatewayRouteTableId} ${tgwName !== 'N/A' ? `(${tgwName})` : ''}`));
        console.log(chalk.cyan(`  Transit Gateway: ${routeTable.TransitGatewayId}`));
        console.log(chalk.cyan(`  State: ${routeTable.State}`));
        console.log(chalk.cyan(`  Creation Time: ${routeTable.CreationTime}`));
        
        // Get and display routes
        console.log(chalk.blue('\n  Routes:'));
        try {
          // Use the showRoutes function to display actual routes
          await showRoutes(client, routeTable.TransitGatewayRouteTableId);
        } catch (routeError) {
          console.error(chalk.red(`  Error fetching routes: ${routeError.message}`));
        }
        
        // Get and display associations
        try {
          const associations = await getTransitGatewayRouteTableAssociations(client, routeTable.TransitGatewayRouteTableId);
          console.log(chalk.blue('\n  Associations:'));
          
          if (!associations || associations.length === 0) {
            console.log(chalk.gray('  No associations found for this route table'));
          } else {
            const associationsTable = createTable(['Resource Type', 'Resource ID', 'State']);
            
            associations.forEach(assoc => {
              associationsTable.push([
                assoc.ResourceType || 'N/A',
                assoc.ResourceId || 'N/A',
                assoc.State || 'N/A'
              ]);
            });
            
            console.log('  ' + associationsTable.toString().replace(/\n/g, '\n  '));
          }
        } catch (error) {
          console.log(chalk.red(`  Error fetching associations: ${error.message}`));
        }
        
        // Get and display propagations
        try {
          const propagations = await getTransitGatewayRouteTablePropagations(client, routeTable.TransitGatewayRouteTableId);
          console.log(chalk.blue('\n  Propagations:'));
          
          if (!propagations || propagations.length === 0) {
            console.log(chalk.gray('  No propagations found for this route table'));
          } else {
            const propagationsTable = createTable(['Resource Type', 'Resource ID', 'State']);
            
            propagations.forEach(prop => {
              propagationsTable.push([
                prop.ResourceType || 'N/A',
                prop.ResourceId || 'N/A',
                prop.State || 'N/A'
              ]);
            });
            
            console.log('  ' + propagationsTable.toString().replace(/\n/g, '\n  '));
          }
        } catch (error) {
          console.log(chalk.red(`  Error fetching propagations: ${error.message}`));
        }
        
        console.log(chalk.gray('\n----------------------------------------'));
      }
    } catch (error) {
      handleError(error, 'Transit Gateway Route Tables');
    }
  },
  
  // VPC Endpoint commands
  async listEndpoints(region, vpcId, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      let endpoints;
      
      if (vpcId) {
        endpoints = await getEndpointsByVPC(client, vpcId);
        console.log(chalk.green.bold(`\nVPC Endpoints for VPC ${vpcId}:`));
      } else {
        endpoints = await listEndpoints(client);
        console.log(chalk.green.bold('\nAll AWS VPC Endpoints:'));
      }
      
      const table = createTable(['Endpoint ID', 'VPC ID', 'Service', 'Type', 'State']);
      
      endpoints.forEach(endpoint => {
        table.push([
          endpoint.VpcEndpointId,
          endpoint.VpcId,
          endpoint.ServiceName,
          endpoint.VpcEndpointType,
          endpoint.State
        ]);
      });
      
      console.log(table.toString());
    } catch (error) {
      handleError(error, 'DescribeVpcEndpoints');
    }
  },

  // Comprehensive VPC details command
  async vpcDetails(region, vpcId, allRegions = false, isGovCloud = false) {
    try {
      if (allRegions) {
        console.log(chalk.yellow('Fetching regions...'));
        // Get appropriate regions based on whether this is GovCloud or not
        let regions;
        if (isGovCloud) {
          regions = await getGovCloudRegions();
          console.log(chalk.green(`Found ${regions.length} GovCloud regions`));
        } else {
          regions = await getAllRegions(isGovCloud);
          console.log(chalk.green(`Found ${regions.length} regions`));
        }
        
        for (const regionName of regions) {
          try {
            console.log(chalk.yellow(`\n===== Checking region ${regionName} =====`));
            
            const client = createEC2Client(regionName, isGovCloud);
            // If VPC ID is specified, check only that VPC
            if (vpcId) {
              try {
                await this.displayVPCDetails(client, vpcId, regionName);
              } catch (error) {
                if (error.name === 'InvalidVpcID.NotFound') {
                  console.log(chalk.gray(`VPC ${vpcId} not found in ${regionName}`));
                } else {
                  console.error(chalk.red(`Error in ${regionName}:`), error.message);
                }
              }
            } else {
              // Otherwise check all VPCs in the region
              const vpcs = await listVPCs(client);
              
              if (vpcs.length === 0) {
                console.log(chalk.gray(`No VPCs found in ${regionName}`));
                continue;
              }
              
              console.log(chalk.green(`Found ${vpcs.length} VPCs in ${regionName}`));
              
              for (const vpc of vpcs) {
                await this.displayVPCDetails(client, vpc.VpcId, regionName);
              }
            }
          } catch (error) {
            console.error(chalk.red(`Error processing region ${regionName}:`), error.message);
          }
        }
      } else {
        // Process single region
        const client = createEC2Client(region, isGovCloud);
        
        if (vpcId) {
          // Process single VPC
          await this.displayVPCDetails(client, vpcId, region);
        } else {
          // Process all VPCs in the region
          const vpcs = await listVPCs(client);
          
          if (vpcs.length === 0) {
            console.log(chalk.yellow(`No VPCs found in region ${region}`));
            return;
          }
          
          console.log(chalk.green(`Found ${vpcs.length} VPCs in ${region}`));
          
          for (const vpc of vpcs) {
            await this.displayVPCDetails(client, vpc.VpcId, region);
          }
        }
      }
    } catch (error) {
      handleVpcDetailsError(error);
    }
  },
  
  async displayVPCDetails(client, vpcId, region) {
    console.log(chalk.green.bold(`\n🔍 VPC DETAILS: ${vpcId} (${region})`));
    console.log(chalk.yellow('='.repeat(60)));
    
    try {
      // Get VPC details
      const vpcDetails = await getVPCFullDetails(client, vpcId);
      
      // Basic VPC info
      const vpcInfoTable = createTable(['Property', 'Value']);
      
      vpcInfoTable.push(
        ['VPC ID', vpcDetails.vpc.VpcId],
        ['CIDR Block', vpcDetails.vpc.CidrBlock],
        ['State', vpcDetails.vpc.State],
        ['Is Default', vpcDetails.vpc.IsDefault ? 'Yes' : 'No'],
        ['DHCP Options ID', vpcDetails.vpc.DhcpOptionsId || 'None']
      );
      
      if (vpcDetails.vpc.CidrBlockAssociationSet && vpcDetails.vpc.CidrBlockAssociationSet.length > 1) {
        const additionalCidrs = vpcDetails.vpc.CidrBlockAssociationSet
          .filter(assoc => assoc.CidrBlock !== vpcDetails.vpc.CidrBlock)
          .map(assoc => `${assoc.CidrBlock} (${assoc.CidrBlockState.State})`)
          .join('\n');
        vpcInfoTable.push(['Additional CIDRs', additionalCidrs || 'None']);
      }
      
      // Tags
      if (vpcDetails.vpc.Tags && vpcDetails.vpc.Tags.length > 0) {
        const tags = vpcDetails.vpc.Tags.map(tag => `${tag.Key}: ${tag.Value}`).join('\n');
        vpcInfoTable.push(['Tags', tags]);
      }

      console.log(chalk.cyan.bold('\n📋 VPC Info:'));
      console.log(vpcInfoTable.toString());
      
      // Subnets
      const subnets = await getSubnetsByVPC(client, vpcId);
      console.log(chalk.cyan.bold(`\n🌐 Subnets (${subnets.length}):`));
      
      if (subnets.length > 0) {
        const subnetTable = createTable(['Subnet ID', 'CIDR Block', 'AZ', 'Public IP', 'Available IPs', 'Tags']);
        
        for (const subnet of subnets) {
          const tags = subnet.Tags 
            ? subnet.Tags.map(tag => `${tag.Key}: ${tag.Value}`).join('\n')
            : '';
            
          subnetTable.push([
            subnet.SubnetId,
            subnet.CidrBlock,
            subnet.AvailabilityZone,
            subnet.MapPublicIpOnLaunch ? 'Yes' : 'No',
            subnet.AvailableIpAddressCount,
            tags
          ]);
        }
        
        console.log(subnetTable.toString());
      } else {
        console.log(chalk.gray('  No subnets found'));
      }
      
      // Route Tables
      const routeTables = await getRouteTablesByVPC(client, vpcId);
      console.log(chalk.cyan.bold(`\n🚦 Route Tables (${routeTables.length}):`));
      
      if (routeTables.length > 0) {
        for (const rt of routeTables) {
          // Get associated subnet names
          const associations = rt.Associations || [];
          const associationInfo = associations.map(assoc => {
            let type = 'Unknown';
            let id = '';
            
            if (assoc.SubnetId) {
              const subnet = subnets.find(s => s.SubnetId === assoc.SubnetId);
              const subnetName = subnet?.Tags?.find(tag => tag.Key === 'Name')?.Value || '';
              type = 'Subnet';
              id = assoc.SubnetId + (subnetName ? ` (${subnetName})` : '');
            } else if (assoc.GatewayId) {
              type = 'Gateway';
              id = assoc.GatewayId;
            } else if (assoc.Main) {
              type = 'Main';
              id = 'VPC Default';
            }
            
            return `${type}: ${id}${assoc.Main ? ' (Main)' : ''}`;
          }).join('\n');
          
          // Get route information
          console.log(chalk.yellow(`\n  Route Table: ${rt.RouteTableId}`));
          
          // Display associated resources
          console.log(chalk.blue(`  Associations: ${associationInfo || 'None'}`));
          
          // Display routes
          const routesTable = createTable(['Destination', 'Target', 'Status']);
          
          (rt.Routes || []).forEach(route => {
            let target = '';
            if (route.GatewayId) target = `Gateway: ${route.GatewayId}`;
            else if (route.NatGatewayId) target = `NAT: ${route.NatGatewayId}`;
            else if (route.TransitGatewayId) target = `TGW: ${route.TransitGatewayId}`;
            else if (route.VpcPeeringConnectionId) target = `Peering: ${route.VpcPeeringConnectionId}`;
            else if (route.NetworkInterfaceId) target = `ENI: ${route.NetworkInterfaceId}`;
            else target = 'Local';
            
            routesTable.push([
              route.DestinationCidrBlock || route.DestinationPrefixListId || 'N/A',
              target,
              route.State || 'N/A'
            ]);
          });
          
          console.log(chalk.blue('  Routes:'));
          console.log('  ' + routesTable.toString().replace(/\n/g, '\n  '));
        }
      } else {
        console.log(chalk.gray('  No route tables found'));
      }
      
      // VPC Endpoints
      const endpoints = await getEndpointsByVPC(client, vpcId);
      console.log(chalk.cyan.bold(`\n🔌 VPC Endpoints (${endpoints.length}):`));
      
      if (endpoints.length > 0) {
        const endpointsTable = createTable(['Endpoint ID', 'Service', 'Type', 'State', 'DNS Entries']);
        
        endpoints.forEach(endpoint => {
          const dnsEntries = endpoint.DnsEntries 
            ? endpoint.DnsEntries.slice(0, 2).map(dns => dns.DnsName).join('\n') + 
              (endpoint.DnsEntries.length > 2 ? `\n...and ${endpoint.DnsEntries.length-2} more` : '')
            : 'None';
            
          endpointsTable.push([
            endpoint.VpcEndpointId,
            endpoint.ServiceName.split('.').slice(-1)[0],
            endpoint.VpcEndpointType,
            endpoint.State,
            dnsEntries
          ]);
        });
        
        console.log(endpointsTable.toString());
      } else {
        console.log(chalk.gray('  No VPC endpoints found'));
      }
      
      // Internet Gateways
      console.log(chalk.cyan.bold(`\n🌐 Internet Gateways (${vpcDetails.internetGateways.length}):`));
      
      if (vpcDetails.internetGateways.length > 0) {
        const igwTable = createTable(['IGW ID', 'State', 'Tags']);
        
        vpcDetails.internetGateways.forEach(igw => {
          const tags = igw.Tags
            ? igw.Tags.map(tag => `${tag.Key}: ${tag.Value}`).join('\n')
            : '';
          
          const state = igw.Attachments && igw.Attachments.length > 0
            ? igw.Attachments[0].State
            : 'Detached';
            
          igwTable.push([
            igw.InternetGatewayId,
            state,
            tags
          ]);
        });
        
        console.log(igwTable.toString());
      } else {
        console.log(chalk.gray('  No Internet Gateways found'));
      }
      
      // NAT Gateways
      console.log(chalk.cyan.bold(`\n🔄 NAT Gateways (${vpcDetails.natGateways.length}):`));
      
      if (vpcDetails.natGateways.length > 0) {
        const natTable = createTable(['NAT ID', 'Subnet', 'Type', 'State', 'Public IP']);
        
        vpcDetails.natGateways.forEach(nat => {
          natTable.push([
            nat.NatGatewayId,
            nat.SubnetId,
            nat.ConnectivityType,
            nat.State,
            nat.NatGatewayAddresses && nat.NatGatewayAddresses.length > 0
              ? nat.NatGatewayAddresses[0].PublicIp || 'N/A'
              : 'N/A'
          ]);
        });
        
        console.log(natTable.toString());
      } else {
        console.log(chalk.gray('  No NAT Gateways found'));
      }
      
      // Transit Gateway Attachments
      const tgwAttachments = await getTransitGatewayAttachmentsByVPC(client, vpcId);
      console.log(chalk.cyan.bold(`\n🔀 Transit Gateway Attachments (${tgwAttachments.length}):`));
      
      if (tgwAttachments.length > 0) {
        const tgwTable = createTable(['TGW ID', 'Attachment ID', 'State']);
        
        tgwAttachments.forEach(attachment => {
          tgwTable.push([
            attachment.TransitGatewayId,
            attachment.TransitGatewayAttachmentId,
            attachment.State
          ]);
        });
        
        console.log(tgwTable.toString());
      } else {
        console.log(chalk.gray('  No Transit Gateway attachments found'));
      }
      
      // VPC Peering connections
      console.log(chalk.cyan.bold(`\n🤝 VPC Peering Connections (${vpcDetails.peeringConnections.length}):`));
      
      if (vpcDetails.peeringConnections.length > 0) {
        const peeringTable = createTable(['Peering ID', 'Peer VPC', 'Peer Region', 'Peer Owner', 'Status']);
        
        vpcDetails.peeringConnections.forEach(peering => {
          // Determine which side is the peer (not the current VPC)
          const peerInfo = peering.AccepterVpcInfo.VpcId === vpcId
            ? peering.RequesterVpcInfo
            : peering.AccepterVpcInfo;
            
          peeringTable.push([
            peering.VpcPeeringConnectionId,
            peerInfo.VpcId,
            peerInfo.Region || 'Same region',
            peerInfo.OwnerId,
            peering.Status.Code
          ]);
        });
        
        console.log(peeringTable.toString());
      } else {
        console.log(chalk.gray('  No VPC peering connections found'));
      }
      
      // Security Groups
      console.log(chalk.cyan.bold(`\n🔒 Security Groups (${vpcDetails.securityGroups.length}):`));
      
      if (vpcDetails.securityGroups.length > 0) {
        const sgTable = createTable(['SG ID', 'Name', 'Description', 'Rules']);
        
        vpcDetails.securityGroups.forEach(sg => {
          const ingressCount = sg.IpPermissions ? sg.IpPermissions.length : 0;
          const egressCount = sg.IpPermissionsEgress ? sg.IpPermissionsEgress.length : 0;
          const rulesSummary = `Inbound: ${ingressCount}, Outbound: ${egressCount}`;
          
          sgTable.push([
            sg.GroupId,
            sg.GroupName,
            sg.Description,
            rulesSummary
          ]);
        });
        
        console.log(sgTable.toString());
      } else {
        console.log(chalk.gray('  No security groups found'));
      }
      
    } catch (error) {
      if (error.name === 'InvalidVpcID.NotFound') {
        console.error(chalk.red(`  VPC ${vpcId} not found in region ${region}`));
      } else {
        handleVpcDetailsError(error);
      }
    }
  },

  // Network changes tracking commands
  async takeNetworkSnapshot(region, isGovCloud = false, name = '') {
    try {
      await takeRegionNetworkSnapshot(region, isGovCloud, name);
    } catch (error) {
      if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
        // Authentication errors are handled by the networkSnapshot.js module
        // Just return to prevent duplicate error messages
        return;
      }
      handleError(error, 'EC2General');
    }
  },
  
  async takeAllNetworkSnapshots(isGovCloud = false, name = '') {
    try {
      await takeAllRegionsNetworkSnapshot(isGovCloud, name);
    } catch (error) {
      if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
        // Authentication errors are handled by the networkSnapshot.js module
        // Just return to prevent duplicate error messages
        return;
      }
      handleError(error, 'EC2General');
    }
  },
  
  async listNetworkSnapshotHistory() {
    try {
      await listNetworkSnapshots();
    } catch (error) {
      console.error(chalk.red('Error listing snapshots:'), error.message);
    }
  },
  
  async compareNetworkChanges(olderSnapshot, newerSnapshot) {
    try {
      if (!newerSnapshot) {
        // If only one snapshot specified, compare with the latest
        const snapshots = await listNetworkSnapshots();
        if (snapshots.length < 2) {
          console.error(chalk.red('Need at least two snapshots to compare'));
          return;
        }
        
        // Use the specified one as older and the latest as newer
        newerSnapshot = snapshots[0].name;
        console.log(chalk.yellow(`Comparing ${olderSnapshot} with latest snapshot: ${newerSnapshot}`));
      }
      
      await compareNetworkSnapshots(olderSnapshot, newerSnapshot);
    } catch (error) {
      console.error(chalk.red('Error comparing snapshots:'), error.message);
    }
  },

  async compareWithLive(snapshotName, region, isGovCloud = false, allRegions = false) {
    try {
      console.log(chalk.yellow('Loading snapshot...'));
      const snapshot = await loadSnapshot(snapshotName);
      
      if (allRegions) {
        // Compare with all regions
        console.log(chalk.yellow('Fetching current state from all regions...'));
        const currentState = await takeAllRegionsNetworkSnapshot(isGovCloud, '_temp_live');
        await compareNetworkSnapshots(snapshotName, '_temp_live');
        
        // Clean up temporary snapshot
        try {
          await fs.unlink(path.join(SNAPSHOTS_DIR, '_temp_live.json'));
        } catch (error) {
          // Ignore cleanup errors
        }
      } else {
        // Compare with single region
        console.log(chalk.yellow(`Fetching current state for region ${region}...`));
        const currentState = await takeRegionNetworkSnapshot(region, isGovCloud, '_temp_live');
        await compareNetworkSnapshots(snapshotName, '_temp_live');
        
        // Clean up temporary snapshot
        try {
          await fs.unlink(path.join(SNAPSHOTS_DIR, '_temp_live.json'));
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      if (error.message.includes('not found')) {
        console.error(chalk.red(`Error: Snapshot '${snapshotName}' not found`));
        console.log(chalk.yellow('\nAvailable snapshots:'));
        await listNetworkSnapshots();
      } else {
        console.error(chalk.red('Error comparing with live environment:'), error.message);
      }
    }
  },

  // PrivateLink commands
  async listPrivateLinkServices(region, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      await listEndpointServices(region);
    } catch (error) {
      handleError(error, 'PrivateLink');
    }
  },
  
  async getPrivateLinkServiceDetails(region, serviceId, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      await getEndpointServiceDetails(region, serviceId);
    } catch (error) {
      handleError(error, 'PrivateLink');
    }
  },
  
  async listDetailedEndpoints(region, vpcId, detailed = false, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      const options = {
        vpcId: vpcId,
        detailed: detailed
      };
      
      await listVpcEndpoints(region, options);
    } catch (error) {
      handleError(error, 'PrivateLink');
    }
  },
  
  async listOwnPrivateLinkServices(region, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      await listOwnEndpointServices(region);
    } catch (error) {
      handleError(error, 'PrivateLink');
    }
  },
  
  async modifyPrivateLinkServicePermissions(region, serviceId, principal, action, isGovCloud = false) {
    try {
      const client = createEC2Client(region, isGovCloud);
      await modifyEndpointServicePermissions(region, serviceId, principal, action);
    } catch (error) {
      handleError(error, 'PrivateLink');
    }
  },

  // Credentials management
  async configureCredentials(method = 'access-keys', save = true) {
    try {
      const credentials = await configureCredentialsInteractive(method, save);
      console.log(chalk.green('\nAWS credentials configured successfully!'));
      
      if (!save) {
        console.log(chalk.yellow('\nNote: These credentials were not saved. They will be used only for this session.'));
      }
      
      return credentials;
    } catch (error) {
      console.error(chalk.red(`Error configuring credentials: ${error.message}`));
      throw error;
    }
  },
  
  async showCurrentCredentials() {
    try {
      const credentials = await loadCredentials();
      
      if (!credentials) {
        console.log(chalk.yellow('No saved credentials found. Using default AWS environment credentials.'));
        return;
      }
      
      console.log(chalk.green('\nCurrent saved credentials:'));
      console.log(chalk.cyan(`Method: ${credentials.method}`));
      
      // Show different details based on method
      switch (credentials.method) {
        case 'access-keys':
          console.log(chalk.cyan(`Access Key ID: ${credentials.accessKeyId.substring(0, 4)}...`));
          console.log(chalk.cyan(`Has Session Token: ${credentials.sessionToken ? 'Yes' : 'No'}`));
          break;
        case 'profile':
          console.log(chalk.cyan(`Profile: ${credentials.profile}`));
          break;
        case 'role':
          console.log(chalk.cyan(`Role ARN: ${credentials.roleArn}`));
          console.log(chalk.cyan(`Session Name: ${credentials.sessionName}`));
          console.log(chalk.cyan(`Source: ${credentials.sourceCredentials.type}`));
          break;
        case 'web-identity':
          console.log(chalk.cyan(`Role ARN: ${credentials.roleArn}`));
          console.log(chalk.cyan(`Token File: ${credentials.tokenFile}`));
          break;
      }
      
      console.log(chalk.cyan(`GovCloud: ${credentials.isGovCloud ? 'Yes' : 'No'}`));
      console.log(chalk.cyan(`Configured: ${new Date(credentials.timestamp).toLocaleString()}`));
      
    } catch (error) {
      console.error(chalk.red(`Error reading credentials: ${error.message}`));
      throw error;
    }
  },

  verifyCredentialsConfig,
};

// Find the method that handles VPC listing
async function checkVPCPermissions(region) {
  try {
    console.log(`→ Testing DescribeVpcs...`);
    const client = createEC2Client(region);
    const vpcs = await listVPCs(client);
    console.log(`✓ Permission check passed for DescribeVpcs`);
    return { passed: true, operation: 'DescribeVpcs' };
  } catch (error) {
    console.error(`Error fetching VPCs: ${error}`);
    console.log(`✗ Permission check failed for DescribeVpcs`);
    return { passed: false, operation: 'DescribeVpcs', error };
  }
}
