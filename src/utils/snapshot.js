import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';

// Define constants for comparison and filtering
const skipProperties = [
  'Tags', 
  'ResponseMetadata', 
  'CreateTime', 
  'LastSeen',
  'ModifyTime',
  'LastModifiedTime',
  'StateTransitionReason',
  'LastModified',
  'LastUpdateTimestamp',
  'CreationTimestamp',
  'OwnerId',
  'RequesterId',
  'RequesterManaged',
  'DhcpOptionsId',
  'AssociationId',
  '_lastUpdated',
  'Association',
  'NetworkInterfaceId',
  'SubnetAssociationId'
];

const orderedArrayProps = ['Routes', 'IpPermissions', 'IpPermissionsEgress'];

const specialComparisonProps = {
  'Routes': compareRoutes,
  'IpPermissions': compareIpPermissions,
  'IpPermissionsEgress': compareIpPermissions,
  'Associations': compareAssociations
};

// Define the directory to store snapshots
export const SNAPSHOTS_DIR = path.join(process.cwd(), 'snapshots');

// Ensure the snapshots directory exists
export const initializeSnapshotDir = async () => {
  try {
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create snapshots directory:', error.message);
    throw error;
  }
};

// Generate a unique name for a snapshot
export const generateSnapshotName = (prefix = '') => {
  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  return `${prefix ? prefix + '-' : ''}${timestamp}`;
};

// Save a snapshot of resources
export const saveSnapshot = async (resources, name = '', type = 'network') => {
  await initializeSnapshotDir();
  
  const snapshotName = name || generateSnapshotName(type);
  const filename = `${snapshotName}.json`;
  const filePath = path.join(SNAPSHOTS_DIR, filename);
  
  // Add metadata to the snapshot
  const snapshot = {
    timestamp: new Date().toISOString(),
    type,
    name: snapshotName,
    resources
  };
  
  try {
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
    console.log(chalk.green(`Snapshot saved as ${filename}`));
    return filePath;
  } catch (error) {
    console.error(`Failed to save snapshot: ${error.message}`);
    throw error;
  }
};

// List all available snapshots
export const listSnapshots = async (type = '') => {
  await initializeSnapshotDir();
  
  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    const snapshots = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(SNAPSHOTS_DIR, file);
        const content = await fs.readFile(filePath, 'utf8');
        const snapshot = JSON.parse(content);
        
        // Filter by type if specified
        if (type && snapshot.type !== type) continue;
        
        snapshots.push({
          name: snapshot.name,
          timestamp: snapshot.timestamp,
          type: snapshot.type,
          file
        });
      } catch (error) {
        console.error(`Error reading snapshot ${file}:`, error.message);
      }
    }
    
    // Sort by timestamp (newest first)
    return snapshots.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    
  } catch (error) {
    console.error('Failed to list snapshots:', error.message);
    throw error;
  }
};

// Load a specific snapshot
export const loadSnapshot = async (name) => {
  await initializeSnapshotDir();
  
  // If name is a filename, use it directly
  let filename = name.endsWith('.json') ? name : `${name}.json`;
  let filePath = path.join(SNAPSHOTS_DIR, filename);
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    // If not found, check if there's a partial match
    try {
      const files = await fs.readdir(SNAPSHOTS_DIR);
      const matchingFile = files.find(file => file.includes(name) && file.endsWith('.json'));
      
      if (matchingFile) {
        filePath = path.join(SNAPSHOTS_DIR, matchingFile);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
      }
      
      console.error(`Snapshot ${name} not found`);
      throw new Error(`Snapshot ${name} not found`);
    } catch (err) {
      console.error(`Error loading snapshot: ${err.message}`);
      throw err;
    }
  }
};

// Compare two snapshots and return differences
export const compareSnapshots = async (olderSnapshotName, newerSnapshotName) => {
  const olderSnapshot = await loadSnapshot(olderSnapshotName);
  const newerSnapshot = await loadSnapshot(newerSnapshotName);
  
  // For simplicity, we'll focus on comparing certain resource types
  const differences = {
    vpcs: compareLists(olderSnapshot.resources.vpcs, newerSnapshot.resources.vpcs, 'VpcId'),
    subnets: compareLists(olderSnapshot.resources.subnets, newerSnapshot.resources.subnets, 'SubnetId'),
    routeTables: compareLists(olderSnapshot.resources.routeTables, newerSnapshot.resources.routeTables, 'RouteTableId'),
    transitGateways: compareLists(olderSnapshot.resources.transitGateways, newerSnapshot.resources.transitGateways, 'TransitGatewayId'),
    internetGateways: compareLists(olderSnapshot.resources.internetGateways, newerSnapshot.resources.internetGateways, 'InternetGatewayId'),
    natGateways: compareLists(olderSnapshot.resources.natGateways, newerSnapshot.resources.natGateways, 'NatGatewayId'),
    vpcEndpoints: compareLists(olderSnapshot.resources.vpcEndpoints, newerSnapshot.resources.vpcEndpoints, 'VpcEndpointId'),
    securityGroups: compareLists(olderSnapshot.resources.securityGroups, newerSnapshot.resources.securityGroups, 'GroupId')
  };
  
  return {
    olderSnapshot: {
      name: olderSnapshot.name,
      timestamp: olderSnapshot.timestamp
    },
    newerSnapshot: {
      name: newerSnapshot.name,
      timestamp: newerSnapshot.timestamp
    },
    differences
  };
};

// Helper function to compare arrays of objects based on an identifier property
function compareLists(oldList = [], newList = [], idProperty) {
  const changes = {
    added: [],
    removed: [],
    modified: []
  };

  // Ensure both lists exist
  if (!Array.isArray(oldList)) oldList = [];
  if (!Array.isArray(newList)) newList = [];
  
  // Convert arrays to maps for easier comparison
  const oldMap = new Map(oldList.map(item => [item[idProperty], item]));
  const newMap = new Map(newList.map(item => [item[idProperty], item]));
  
  // Find added and modified items
  for (const [id, newItem] of newMap.entries()) {
    if (!oldMap.has(id)) {
      changes.added.push(newItem);
    } else {
      const oldItem = oldMap.get(id);
      const diff = findDifferences(oldItem, newItem);
      if (Object.keys(diff).length > 0) {
        changes.modified.push({
          id,
          differences: diff,
          old: oldItem,
          new: newItem
        });
      }
    }
  }
  
  // Find removed items
  for (const [id, oldItem] of oldMap.entries()) {
    if (!newMap.has(id)) {
      changes.removed.push(oldItem);
    }
  }
  
  return changes;
}

// Helper function to find differences between two objects
function findDifferences(oldObj, newObj, path = '') {
  const differences = {};
  
  // If either object is null/undefined, compare directly
  if (!oldObj || !newObj) {
    if (oldObj !== newObj) {
      differences[path || 'value'] = { old: oldObj, new: newObj };
    }
    return differences;
  }

  // Check all properties in the old object
  for (const key in oldObj) {
    if (skipProperties.includes(key)) continue;
    
    const oldValue = oldObj[key];
    const newValue = newObj[key];
    const currentPath = path ? `${path}.${key}` : key;
    
    // Check if this property needs special comparison
    if (key in specialComparisonProps) {
      const diff = specialComparisonProps[key](oldValue, newValue);
      if (diff) {
        differences[currentPath] = diff;
      }
      continue;
    }

    // Handle arrays that need ordered comparison
    if (orderedArrayProps.includes(key)) {
      const arrayDiff = compareOrderedArrays(oldValue, newValue, key);
      if (arrayDiff) {
        differences[currentPath] = arrayDiff;
      }
      continue;
    }

    // Handle nested objects
    if (typeof oldValue === 'object' && oldValue !== null && 
        typeof newValue === 'object' && newValue !== null) {
      // Special handling for arrays
      if (Array.isArray(oldValue)) {
        // For arrays, compare length and elements
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          differences[currentPath] = { old: oldValue, new: newValue };
        }
      } else {
        const nestedDiffs = findDifferences(oldValue, newValue, currentPath);
        Object.assign(differences, nestedDiffs);
      }
    } 
    // Compare simple values
    else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      differences[currentPath] = { old: oldValue, new: newValue };
    }
  }
  
  // Check for new properties in new object
  for (const key in newObj) {
    if (skipProperties.includes(key)) continue;
    
    if (!(key in oldObj)) {
      const currentPath = path ? `${path}.${key}` : key;
      differences[currentPath] = { old: undefined, new: newObj[key] };
    }
  }
  
  return differences;
}

// Normalize AWS resource objects to ensure consistent structure
function normalizeAwsResource(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Create shallow copy to avoid mutation
  const normalized = { ...obj };
  
  // Remove AWS metadata fields that aren't needed for comparison
  delete normalized.ResponseMetadata;
  delete normalized.$metadata;
  delete normalized._lastUpdated;
  
  // Normalize timestamps to ISO strings for consistent comparison
  for (const [key, value] of Object.entries(normalized)) {
    if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else if (value && typeof value === 'object') {
      normalized[key] = normalizeAwsResource(value);
    }
  }
  
  return normalized;
}

// Helper function to compare ordered arrays (like routes or security group rules)
function compareOrderedArrays(oldArray, newArray, type) {
  if (!Array.isArray(oldArray)) oldArray = [];
  if (!Array.isArray(newArray)) newArray = [];

  // Convert arrays to comparable strings based on type
  const stringifyItem = (item) => {
    switch(type) {
      case 'Routes':
        return `${item.DestinationCidrBlock || item.DestinationPrefixListId}-${item.GatewayId || item.NatGatewayId || item.TransitGatewayId || item.NetworkInterfaceId || 'local'}`;
      case 'IpPermissions':
      case 'IpPermissionsEgress':
        return `${item.IpProtocol}-${item.FromPort || ''}-${item.ToPort || ''}-${JSON.stringify(item.IpRanges)}`;
      default:
        return JSON.stringify(item);
    }
  };

  const oldStrings = oldArray.map(stringifyItem);
  const newStrings = newArray.map(stringifyItem);

  if (JSON.stringify(oldStrings) !== JSON.stringify(newStrings)) {
    return {
      old: oldArray,
      new: newArray
    };
  }

  return null;
}

// Helper function to compare routes
function compareRoutes(oldRoutes, newRoutes) {
  if (!Array.isArray(oldRoutes)) oldRoutes = [];
  if (!Array.isArray(newRoutes)) newRoutes = [];
  
  const normalizeRoute = route => ({
      destination: route.DestinationCidrBlock || route.DestinationPrefixListId || '',
      target: route.GatewayId || route.NatGatewayId || route.TransitGatewayId || 
              route.NetworkInterfaceId || route.VpcPeeringConnectionId || 'local',
      state: route.State || 'active'
  });

  const oldNormalized = oldRoutes.map(normalizeRoute);
  const newNormalized = newRoutes.map(normalizeRoute);

  if (JSON.stringify(oldNormalized) !== JSON.stringify(newNormalized)) {
      return { old: oldRoutes, new: newRoutes };
  }
  return null;
}

// Helper function to compare IP permissions
function compareIpPermissions(oldPerms, newPerms) {
  if (!Array.isArray(oldPerms)) oldPerms = [];
  if (!Array.isArray(newPerms)) newPerms = [];
  
  const normalizePermission = perm => ({
      protocol: perm.IpProtocol,
      fromPort: perm.FromPort || '',
      toPort: perm.ToPort || '',
      ipRanges: (perm.IpRanges || []).map(r => r.CidrIp).sort(),
      ipv6Ranges: (perm.Ipv6Ranges || []).map(r => r.CidrIpv6).sort(),
      groups: (perm.UserIdGroupPairs || []).map(g => g.GroupId).sort()
  });

  const oldNormalized = oldPerms.map(normalizePermission);
  const newNormalized = newPerms.map(normalizePermission);

  if (JSON.stringify(oldNormalized) !== JSON.stringify(newNormalized)) {
      return { old: oldPerms, new: newPerms };
  }
  return null;
}

// Helper function to compare associations
function compareAssociations(oldAssoc, newAssoc) {
  if (!Array.isArray(oldAssoc)) oldAssoc = [];
  if (!Array.isArray(newAssoc)) newAssoc = [];
  
  const normalizeAssociation = assoc => ({
      subnet: assoc.SubnetId || '',
      gateway: assoc.GatewayId || '',
      main: !!assoc.Main
  });

  const oldNormalized = oldAssoc.map(normalizeAssociation);
  const newNormalized = newAssoc.map(normalizeAssociation);

  if (JSON.stringify(oldNormalized) !== JSON.stringify(newNormalized)) {
      return { old: oldAssoc, new: newAssoc };
  }
  return null;
}

// Format and display differences in a readable way
export const displayDifferences = (comparisonResult) => {
  const { olderSnapshot, newerSnapshot, differences } = comparisonResult;
  
  console.log('\n' + chalk.yellow.bold('═══════════════════════════════════════════════'));
  console.log(chalk.yellow.bold('             INFRASTRUCTURE CHANGES'));
  console.log(chalk.yellow.bold('═══════════════════════════════════════════════\n'));
  
  console.log(chalk.dim('FROM: ') + chalk.cyan(`${olderSnapshot.name}`));
  console.log(chalk.dim('      ') + chalk.dim(new Date(olderSnapshot.timestamp).toLocaleString()));
  console.log(chalk.dim('TO:   ') + chalk.cyan(`${newerSnapshot.name}`));
  console.log(chalk.dim('      ') + chalk.dim(new Date(newerSnapshot.timestamp).toLocaleString()));
  console.log();
  
  let changeCount = 0;
  
  // Loop through each resource type
  for (const [resourceType, changes] of Object.entries(differences)) {
    const { added, removed, modified } = changes;
    
    // Skip if no changes
    if (added.length === 0 && removed.length === 0 && modified.length === 0) continue;
    
    changeCount++;
    
    // Print resource type header
    console.log(chalk.yellow.bold(`\n┌─ ${resourceType.toUpperCase()} `));
    console.log(chalk.yellow.bold('└' + '─'.repeat(50)));
    
    // Display changes summary
    const summary = [];
    if (added.length > 0) summary.push(chalk.green(`${added.length} added`));
    if (removed.length > 0) summary.push(chalk.red(`${removed.length} removed`));
    if (modified.length > 0) summary.push(chalk.blue(`${modified.length} modified`));
    console.log(`  ${summary.join(' • ')}\n`);
    
    // Display added resources
    if (added.length > 0) {
      for (const item of added) {
        displayResourceSummary(item, resourceType, 'added');
      }
    }
    
    // Display removed resources
    if (removed.length > 0) {
      for (const item of removed) {
        displayResourceSummary(item, resourceType, 'removed');
      }
    }
    
    // Display modified resources
    if (modified.length > 0) {
      modified.forEach((item, index) => {
        displayModificationDetails(item, resourceType);
        if (index < modified.length - 1) console.log(); // Add space between items
      });
    }
  }
  
  if (changeCount === 0) {
    console.log(chalk.green.bold('\n✓ No changes detected between snapshots'));
  }
  
  console.log('\n' + chalk.yellow.bold('═══════════════════════════════════════════════\n'));
};

// Helper to display resource summary based on type
function displayResourceSummary(resource, type, changeType) {
  const symbol = changeType === 'added' ? '✚' : '✖';
  const color = changeType === 'added' ? chalk.green : chalk.red;
  
  let summary = '';
  switch(type) {
    case 'vpcs':
      summary = `${resource.VpcId}\n    └─ CIDR: ${resource.CidrBlock} • State: ${resource.State}`;
      break;
    case 'subnets':
      summary = `${resource.SubnetId}\n    └─ VPC: ${resource.VpcId} • CIDR: ${resource.CidrBlock}`;
      break;
    case 'routeTables':
      summary = `${resource.RouteTableId}\n    └─ VPC: ${resource.VpcId}`;
      break;
    case 'transitGateways':
      summary = `${resource.TransitGatewayId}\n    └─ State: ${resource.State}`;
      break;
    case 'internetGateways':
      summary = resource.InternetGatewayId;
      break;
    case 'natGateways':
      summary = `${resource.NatGatewayId}\n    └─ VPC: ${resource.VpcId} • State: ${resource.State}`;
      break;
    case 'vpcEndpoints':
      summary = `${resource.VpcEndpointId}\n    └─ ${resource.ServiceName} • State: ${resource.State}`;
      break;
    case 'securityGroups':
      summary = `${resource.GroupId}\n    └─ ${resource.GroupName} • VPC: ${resource.VpcId}`;
      break;
    default:
      summary = JSON.stringify(resource);
  }
  
  console.log(color(`  ${symbol} ${summary}`));
}

// Helper to display modification details
function displayModificationDetails(item, type) {
  console.log(chalk.blue(`  ↻ ${item.id}`));
  
  const table = new Table({
    head: ['Property', 'From', 'To'],
    style: {
      head: ['dim'],
      border: ['dim']
    },
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤', 'middle': '│'
    },
    wordWrap: true,
    wrapOnWordBoundary: false,
    // Increase column widths to prevent clipping
    colWidths: [40, 70, 70]
  });

  // Filter and sort differences
  const significantChanges = Object.entries(item.differences)
    .filter(([_, values]) => {
      const oldVal = JSON.stringify(values.old);
      const newVal = JSON.stringify(values.new);
      return oldVal !== newVal;
    })
    .sort(([a], [b]) => a.localeCompare(b));

  // Format and display each change
  for (const [property, values] of significantChanges) {
    const oldValue = formatValue(values.old, 'old');
    const newValue = formatValue(values.new, 'new');
    
    table.push([
      chalk.dim(wrapText(property, 38)),  // Adjusted width for property column
      oldValue.split('\n').join('\n'),    // Ensure multi-line values display correctly
      newValue.split('\n').join('\n')     // Ensure multi-line values display correctly
    ]);
  }
  
  if (significantChanges.length > 0) {
    console.log(table.toString().split('\n').map(line => `    ${line}`).join('\n'));
  }
}

// Add helper to format values consistently
function formatValue(value, type) {
  if (value === undefined) return chalk.dim('undefined');
  if (value === null) return chalk.dim('null');
  
  let formatted = '';
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      formatted = formatArrayValue(value);
    } else {
      // Format objects with one property per line
      formatted = Object.entries(value)
        .filter(([key]) => !skipProperties.includes(key))
        .map(([key, val]) => `${key}:\n  ${formatSimpleValue(val)}`)
        .join('\n');
    }
  } else {
    formatted = formatSimpleValue(value);
  }
  
  return type === 'old' ? chalk.red(formatted) : chalk.green(formatted);
}

// Add helper for simple value formatting
function formatSimpleValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    return '{...}';
  }
  return String(value);
}

// Add helper for array formatting
function formatArrayValue(arr) {
  if (arr.length === 0) return '[]';
  if (arr.length > 3) {
    return `[${arr.length} items]`;
  }
  return arr.map((item, index) => {
    if (typeof item === 'object') {
      const properties = Object.entries(item)
        .filter(([key]) => !skipProperties.includes(key))
        .map(([key, val]) => `    ${key}: ${formatSimpleValue(val)}`)
        .join('\n');
      return `${index}:\n${properties}`;
    }
    return `${index}: ${String(item)}`;
  }).join('\n');
}

// Helper to format and highlight changes in values
function highlightValue(value, otherValue, type = '') {
  if (value === undefined) return chalk.dim('undefined');
  if (value === null) return chalk.dim('null');
  
  // For arrays, show detailed comparison
  if (Array.isArray(value)) {
    return formatArrayDiff(value, otherValue, type);
  }
  
  // For objects, show detailed comparison
  if (typeof value === 'object') {
    const formatted = formatObjectToKeyValue(value);
    if (formatted.length > 100) {
      const keys = Object.keys(value);
      const summary = `${keys.length} properties`;
      const changes = findChangedProperties(value, otherValue);
      
      if (changes.length > 0) {
        return `${summary}\nChanged: ${changes.join(', ')}`;
      }
      return summary;
    }
    
    return type === 'old' ? chalk.red(formatted) : chalk.green(formatted);
  }
  
  // For simple values, highlight the differences
  const strValue = value.toString();
  const isDifferent = JSON.stringify(value) !== JSON.stringify(otherValue);
  return isDifferent ? chalk.yellow(strValue) : (type === 'old' ? chalk.red(strValue) : chalk.green(strValue));
}

// Helper to format array differences
function formatArrayDiff(array, otherArray, type) {
  if (!Array.isArray(otherArray)) otherArray = [];
  
  // For small arrays, show full comparison
  if (array.length <= 3) {
    const formatted = array.map(item => {
      if (typeof item === 'object') {
        return formatObjectToKeyValue(item);
      }
      return item.toString();
    }).join('\n');
    
    return type === 'old' ? chalk.red(formatted) : chalk.green(formatted);
  }
  
  // For larger arrays, show summary with changes
  const added = array.filter(item => !otherArray.includes(item));
  const removed = otherArray.filter(item => !array.includes(item));
  
  let summary = `${array.length} items`;
  if (added.length || removed.length) {
    summary += `\n${added.length} added, ${removed.length} removed`;
  }
  
  return type === 'old' ? chalk.red(summary) : chalk.green(summary);
}

// Helper to format arrays for table display
function formatArrayForTable(array, otherArray) {
  if (!Array.isArray(array)) return 'Invalid array';
  if (array.length === 0) return '[]';
  
  return array.map(item => {
    if (typeof item === 'object') {
      return formatObjectToKeyValue(item);
    }
    return item.toString();
  }).join('\n');
}

// Helper to format objects for table display
function formatObjectForTable(obj, otherObj) {
  try {
    if (!obj || Object.keys(obj).length === 0) return '{}';
    return formatObjectToKeyValue(obj);
  } catch (error) {
    return String(obj);
  }
}

// Helper to format object to key-value pairs
function formatObjectToKeyValue(obj, indent = 0) {
  if (!obj || typeof obj !== 'object') return String(obj);
  
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    const indentation = ' '.repeat(indent);
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${indentation}${key}: []`);
        } else if (typeof value[0] === 'object') {
          // For arrays of objects, format each item
          lines.push(`${indentation}${key}:`);
          value.forEach((item, index) => {
            lines.push(`${indentation}  ${index + 1}.${formatObjectToKeyValue(item, indent + 4)}`);
          });
        } else {
          // For simple arrays, show inline
          lines.push(`${indentation}${key}: [${value.join(', ')}]`);
        }
      } else {
        // For nested objects
        lines.push(`${indentation}${key}:`);
        lines.push(formatObjectToKeyValue(value, indent + 2));
      }
    } else {
      lines.push(`${indentation}${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

// Remove second formatObjectDiff function and keep these remaining helpers
function findChangedProperties(obj1, obj2) {
  if (!obj2 || typeof obj2 !== 'object') return Object.keys(obj1);
  
  return Object.keys(obj1).filter(key => {
    if (!(key in obj2)) return true;
    return JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key]);
  });
}

// Helper to wrap text at specified width
function wrapText(text, width) {
  if (typeof text !== 'string') return text;
  
  const lines = [];
  let line = '';
  
  text.split(/\s+/).forEach(word => {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  });
  
  if (line) lines.push(line);
  return lines.join('\n');
}
