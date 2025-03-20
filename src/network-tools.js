import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base function to execute network tools
 */
function executeNetworkTool(toolName, args) {
  return new Promise((resolve, reject) => {
    const toolPath = path.join(__dirname, '../bin', toolName);
    
    execFile(toolPath, args, (error, stdout) => {
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse result from ${toolName}: ${e.message}`));
      }
    });
  });
}

/**
 * Test network connectivity 
 */
export function testConnectivity(targetIp, options = {}) {
  const { mode = 'ping', port = 80, timeout = 5 } = options;
  const args = [targetIp, mode];
  
  if (mode === 'tcp') {
    args.push(port.toString());
  }
  args.push(timeout.toString());
  
  return executeNetworkTool('connectivity', args);
}

/**
 * Scan ports on target IP
 */
export function scanPorts(targetIp, portRange, timeout = 2) {
  return executeNetworkTool('portscan', [targetIp, portRange, timeout.toString()]);
}

/**
 * Run traceroute to target
 */
export function traceroute(targetIp, maxHops = 30) {
  return executeNetworkTool('traceroute', [targetIp, maxHops.toString()]);
}

/**
 * Lookup DNS information
 */
export function dnsLookup(domain, recordType = 'all', server = null) {
  const args = [domain, recordType];
  if (server) args.push(server);
  
  return executeNetworkTool('dns', args);
}

/**
 * Get network interface information
 */
export function getNetworkInterfaces() {
  return executeNetworkTool('interfaces', []);
}

/**
 * Test HTTP endpoint
 */
export function testHttpEndpoint(url, options = {}) {
  const { 
    timeout = 10, 
    followRedirects = true, 
    insecure = false 
  } = options;
  
  const args = [
    url, 
    timeout.toString(), 
    followRedirects ? '1' : '0', 
    insecure ? '1' : '0'
  ];
  
  return executeNetworkTool('http-test', args);
}

// Default export for backward compatibility
export default {
  testConnectivity,
  scanPorts,
  traceroute,
  dnsLookup,
  getNetworkInterfaces,
  testHttpEndpoint
};