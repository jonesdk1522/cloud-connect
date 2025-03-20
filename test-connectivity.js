import { testConnectivity } from './src/connectivity.js';

async function runTests() {
  try {
    console.log('Testing ping to Google DNS:');
    const pingResult = await testConnectivity('8.8.8.8', { mode: 'ping' });
    console.log(pingResult);
    
    console.log('\nTesting TCP connection to Google (port 80):');
    const tcpResult = await testConnectivity('142.250.69.78', { 
      mode: 'tcp', 
      port: 80 
    });
    console.log(tcpResult);
    
    console.log('\nTesting invalid IP (should fail):');
    const failResult = await testConnectivity('192.0.2.1', { 
      mode: 'ping',
      timeout: 2 
    });
    console.log(failResult);
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

runTests();
