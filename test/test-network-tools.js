import { testConnectivity, scanPorts, traceroute, dnsLookup, getNetworkInterfaces, testHttpEndpoint } from '../src/network-tools.js';

// Helper to run tests
async function runTest(name, testFn) {
  console.log(`\n=== Testing ${name} ===`);
  try {
    const result = await testFn();
    console.log('SUCCESS ✅');
    console.log(JSON.stringify(result, null, 2));
    return true;
  } catch (error) {
    console.error('FAILED ❌');
    console.error(error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results = [];
  
  // Test connectivity
  results.push(await runTest('Ping Connectivity', () => 
    testConnectivity('8.8.8.8', { mode: 'ping', timeout: 2 })
  ));
  
  results.push(await runTest('TCP Connectivity', () => 
    testConnectivity('8.8.8.8', { mode: 'tcp', port: 53, timeout: 2 })
  ));
  
  // Test port scanning
  results.push(await runTest('Port Scanning', () => 
    scanPorts('8.8.8.8', '53-54', 1)
  ));
  
  // Test traceroute
  results.push(await runTest('Traceroute', () => 
    traceroute('8.8.8.8', 10)
  ));
  
  // Test DNS lookup
  results.push(await runTest('DNS Lookup', () => 
    dnsLookup('google.com', 'all')
  ));
  
  // Test network interfaces
  results.push(await runTest('Network Interfaces', () => 
    getNetworkInterfaces()
  ));
  
  // Test HTTP endpoint
  results.push(await runTest('HTTP Test', () => 
    testHttpEndpoint('https://www.google.com', { timeout: 5 })
  ));
  
  // Summary
  const success = results.filter(Boolean).length;
  console.log(`\n=== Test Summary ===`);
  console.log(`${success} out of ${results.length} tests passed.`);
}

// Run all tests
runAllTests().catch(error => {
  console.error('Error running tests:', error);
  process.exit(1);
});
