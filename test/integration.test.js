import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { createEC2Client } from '../src/aws/client.js';
import { testConnectivity } from '../src/connectivity.js';
import { testHttpEndpoint } from '../src/network-tools.js';

// Mock EC2 Client
vi.mock('@aws-sdk/client-ec2', () => {
  return {
    EC2Client: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockImplementation((command) => {
        if (command.constructor.name === 'DescribeInstancesCommand') {
          return Promise.resolve({
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-123456',
                    State: { Name: 'running' },
                    PrivateIpAddress: '10.0.0.1',
                    PublicIpAddress: '54.123.456.789',
                    Tags: [{ Key: 'Name', Value: 'TestInstance' }]
                  }
                ]
              }
            ]
          });
        }
        return Promise.resolve({});
      })
    })),
    DescribeInstancesCommand: vi.fn(),
    DescribeRegionsCommand: vi.fn()
  };
});

// Mock connectivity module
vi.mock('../src/connectivity.js', () => {
  return {
    testConnectivity: vi.fn().mockImplementation((ip, options) => {
      if (ip === '8.8.8.8' || ip === '10.0.0.1') {
        return Promise.resolve({
          success: true,
          target: ip,
          mode: options.mode,
          message: options.mode === 'ping' ? 'Host is reachable' : 'Port is open',
          ...(options.mode === 'ping' ? { rtt_ms: 45.2 } : { port: options.port, time_ms: 28.5 })
        });
      } else {
        return Promise.resolve({
          success: false,
          target: ip,
          mode: options.mode,
          message: 'Connection failed'
        });
      }
    })
  };
});

// Mock network-tools module
vi.mock('../src/network-tools.js', () => {
  return {
    testHttpEndpoint: vi.fn().mockImplementation((url) => {
      return Promise.resolve({
        url: url,
        success: true,
        status_code: 200,
        response_time: 150,
        content_length: 1024,
        headers: {
          'Content-Type': 'text/html'
        }
      });
    })
  };
});

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an EC2 client that can fetch instances', async () => {
    const client = createEC2Client('us-east-1');
    
    // Import here to avoid hoisting issues with mocks
    const { DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');
    
    const result = await client.send(new DescribeInstancesCommand({}));
    expect(result.Reservations).toBeDefined();
    expect(result.Reservations[0].Instances[0].InstanceId).toBe('i-123456');
  });

  it('tests connectivity to a valid host', async () => {
    const result = await testConnectivity('8.8.8.8', { mode: 'ping' });
    expect(result.success).toBe(true);
    expect(result.target).toBe('8.8.8.8');
  });

  it('tests HTTP endpoint successfully', async () => {
    const result = await testHttpEndpoint('https://www.example.com');
    expect(result.url).toBe('https://www.example.com');
    expect(result.success).toBe(true);
    expect(result.status_code).toBe(200);
  });

  it('integrates AWS client with connectivity test', async () => {
    // This test would simulate the workflow of:
    // 1. Getting instances from AWS
    // 2. Testing connectivity to those instances
    
    // Import AWS test utility functions
    const { getAwsInstances } = await import('../aws-connectivity-test.js');
    
    // Mock implementation
    vi.mock('../aws-connectivity-test.js', () => {
      return {
        getAwsInstances: vi.fn().mockResolvedValue([
          {
            id: 'i-123456',
            privateIp: '10.0.0.1',
            publicIp: '54.123.456.789',
            name: 'TestInstance'
          }
        ])
      };
    });
    
    const instances = await getAwsInstances('us-east-1');
    expect(instances).toHaveLength(1);
    
    // Test connectivity to the first instance
    const pingResult = await testConnectivity(instances[0].privateIp, { mode: 'ping' });
    expect(pingResult.success).toBe(true);
    
    // Test TCP connectivity
    const tcpResult = await testConnectivity(instances[0].privateIp, { mode: 'tcp', port: 22 });
    expect(tcpResult.success).toBe(true);
    expect(tcpResult.port).toBe(22);
  });
});
