import { createEC2Client, getAllRegions, getGovCloudRegions, testCredentials } from '../aws/client.js';
import { listVPCs } from './vpc.js';
import { listSubnets } from './subnet.js';
import { listRouteTables } from './routeTable.js';
import { listTransitGateways } from './transitGateway.js';
import { listEndpoints } from './endpoint.js';
import { 
  saveSnapshot, 
  listSnapshots, 
  loadSnapshot, 
  compareSnapshots, 
  displayDifferences 
} from '../utils/snapshot.js';
import chalk from 'chalk';

// Take a snapshot of all network resources in a region
export const takeRegionNetworkSnapshot = async (region, isGovCloud = false, snapshotName = '') => {
  try {
    console.log(chalk.yellow(`Taking network snapshot for region ${region}${isGovCloud ? ' (GovCloud)' : ''}...`));
    
    // First test credentials
    const credentialsValid = await testCredentials(isGovCloud);
    if (!credentialsValid) {
      if (isGovCloud) {
        throw new Error(`AWS GovCloud authentication failed. Make sure you have valid GovCloud credentials for ${region}.`);
      } else {
        throw new Error(`AWS authentication failed. Make sure you have valid credentials for ${region}.`);
      }
    }
    
    const client = createEC2Client(region, isGovCloud);
    
    // Collect network resources
    console.log(chalk.cyan('  Collecting VPCs...'));
    const vpcs = await listVPCs(client);
    
    console.log(chalk.cyan('  Collecting Subnets...'));
    const subnets = await listSubnets(client);
    
    console.log(chalk.cyan('  Collecting Route Tables...'));
    const routeTables = await listRouteTables(client);
    
    console.log(chalk.cyan('  Collecting Transit Gateways...'));
    const transitGateways = await listTransitGateways(client);
    
    console.log(chalk.cyan('  Collecting VPC Endpoints...'));
    const vpcEndpoints = await listEndpoints(client);
    
    // Create snapshot resources object
    const resources = {
      region,
      timestamp: new Date().toISOString(),
      vpcs,
      subnets,
      routeTables,
      transitGateways,
      vpcEndpoints
    };
    
    // Generating a name if one isn't provided
    const generatedName = snapshotName || `network-${region}`;
    
    // Save the snapshot
    const snapshotPath = await saveSnapshot(resources, generatedName, 'network');
    console.log(chalk.green(`Network snapshot for region ${region} saved!`));
    
    return {
      path: snapshotPath,
      name: generatedName,
      resources
    };
  } catch (error) {
    if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
      if (isGovCloud) {
        console.error(chalk.red(`GovCloud Authentication Error: ${error.message}`));
        console.error(chalk.yellow('Note: GovCloud credentials are separate from standard AWS credentials.'));
        console.error(chalk.yellow('You may need to set up separate credentials for GovCloud using:'));
        console.error(chalk.cyan('  aws configure --profile govcloud'));
        console.error(chalk.yellow('And then set the AWS_PROFILE environment variable:'));
        console.error(chalk.cyan('  export AWS_PROFILE=govcloud'));
      } else {
        console.error(chalk.red(`Authentication Error: ${error.message}`));
        console.error(chalk.yellow('Make sure your AWS credentials are correctly configured:'));
        console.error(chalk.cyan('  aws configure'));
      }
    } else {
      console.error(chalk.red(`Error taking network snapshot for region ${region}:`), error.message);
    }
    throw error;
  }
};

// Take a snapshot of network resources across all regions
export const takeAllRegionsNetworkSnapshot = async (isGovCloud = false, snapshotName = '') => {
  try {
    console.log(chalk.yellow(`Taking network snapshot for all ${isGovCloud ? 'GovCloud ' : ''}regions...`));
    
    // First test credentials
    const credentialsValid = await testCredentials(isGovCloud);
    if (!credentialsValid) {
      if (isGovCloud) {
        throw new Error('AWS GovCloud authentication failed. Make sure you have valid GovCloud credentials configured.');
      } else {
        throw new Error('AWS authentication failed. Make sure you have valid credentials configured.');
      }
    }
    
    // Get all regions
    let regions;
    try {
      if (isGovCloud) {
        regions = await getGovCloudRegions();
      } else {
        regions = await getAllRegions(isGovCloud);
      }
    } catch (error) {
      if (error.message.includes('credentials')) {
        if (isGovCloud) {
          throw new Error('GovCloud authentication failed when retrieving regions. Make sure your GovCloud credentials are valid.');
        } else {
          throw new Error('AWS authentication failed when retrieving regions. Make sure your credentials are valid.');
        }
      }
      throw error;
    }
    
    console.log(chalk.green(`Found ${regions.length} ${isGovCloud ? 'GovCloud ' : ''}regions to scan`));
    
    // Store all resources from all regions
    const allResources = {
      regions: {},
      timestamp: new Date().toISOString(),
      isGovCloud
    };
    
    // Process each region
    for (const region of regions) {
      try {
        console.log(chalk.yellow(`\nProcessing region: ${region}`));
        const client = createEC2Client(region, isGovCloud);
        
        // Collect resources for this region
        const resources = {
          vpcs: [],
          subnets: [],
          routeTables: [],
          transitGateways: [],
          vpcEndpoints: [],
          internetGateways: [],
          natGateways: [],
          securityGroups: []
        };
        
        try {
          resources.vpcs = await listVPCs(client);
          console.log(chalk.cyan(`  VPCs: ${resources.vpcs.length}`));
        } catch (error) {
          console.log(chalk.red(`  Error fetching VPCs: ${error.message}`));
        }
        
        try {
          resources.subnets = await listSubnets(client);
          console.log(chalk.cyan(`  Subnets: ${resources.subnets.length}`));
        } catch (error) {
          console.log(chalk.red(`  Error fetching Subnets: ${error.message}`));
        }
        
        try {
          resources.routeTables = await listRouteTables(client);
          console.log(chalk.cyan(`  Route Tables: ${resources.routeTables.length}`));
        } catch (error) {
          console.log(chalk.red(`  Error fetching Route Tables: ${error.message}`));
        }
        
        try {
          resources.transitGateways = await listTransitGateways(client);
          console.log(chalk.cyan(`  Transit Gateways: ${resources.transitGateways.length}`));
        } catch (error) {
          console.log(chalk.red(`  Error fetching Transit Gateways: ${error.message}`));
        }
        
        try {
          resources.vpcEndpoints = await listEndpoints(client);
          console.log(chalk.cyan(`  VPC Endpoints: ${resources.vpcEndpoints.length}`));
        } catch (error) {
          console.log(chalk.red(`  Error fetching VPC Endpoints: ${error.message}`));
        }
        
        // Add resources from this region to the overall collection
        allResources.regions[region] = resources;
      } catch (error) {
        console.error(chalk.red(`Error processing region ${region}:`), error.message);
      }
    }
    
    // Generate a name if one isn't provided
    const environment = isGovCloud ? 'govcloud' : 'aws';
    const generatedName = snapshotName || `network-all-${environment}`;
    
    // Save the snapshot
    const snapshotPath = await saveSnapshot(allResources, generatedName, 'network-all');
    console.log(chalk.green('\nNetwork snapshot for all regions saved!'));
    
    return {
      path: snapshotPath,
      name: generatedName,
      regions: Object.keys(allResources.regions).length
    };
  } catch (error) {
    if (error.message.includes('credentials') || error.name === 'CredentialsProviderError') {
      if (isGovCloud) {
        console.error(chalk.red(`GovCloud Authentication Error: ${error.message}`));
        console.error(chalk.yellow('Note: GovCloud credentials are separate from standard AWS credentials.'));
        console.error(chalk.yellow('You may need to set up separate credentials for GovCloud using:'));
        console.error(chalk.cyan('  aws configure --profile govcloud'));
        console.error(chalk.yellow('And then set the AWS_PROFILE environment variable:'));
        console.error(chalk.cyan('  export AWS_PROFILE=govcloud'));
      } else {
        console.error(chalk.red(`Authentication Error: ${error.message}`));
        console.error(chalk.yellow('Make sure your AWS credentials are correctly configured:'));
        console.error(chalk.cyan('  aws configure'));
      }
    } else {
      console.error(chalk.red('Error taking network snapshot for all regions:'), error.message);
    }
    throw error;
  }
};

// Compare two network snapshots
export const compareNetworkSnapshots = async (olderSnapshotName, newerSnapshotName) => {
  try {
    const comparison = await compareSnapshots(olderSnapshotName, newerSnapshotName);
    displayDifferences(comparison);
    return comparison;
  } catch (error) {
    console.error(chalk.red('Error comparing network snapshots:'), error.message);
    throw error;
  }
};

// List all network snapshots
export const listNetworkSnapshots = async () => {
  try {
    const snapshots = await listSnapshots('network');
    
    console.log(chalk.yellow('\nAvailable Network Snapshots:'));
    
    if (snapshots.length === 0) {
      console.log(chalk.gray('  No snapshots found.'));
      return [];
    }
    
    snapshots.forEach((snapshot, index) => {
      const date = new Date(snapshot.timestamp).toLocaleString();
      console.log(chalk.cyan(`  ${index + 1}. ${snapshot.name} - ${date}`));
    });
    
    return snapshots;
  } catch (error) {
    console.error(chalk.red('Error listing network snapshots:'), error.message);
    throw error;
  }
};
