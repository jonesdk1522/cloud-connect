import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { 
  testConnectivity,
  scanPorts,
  traceroute,
  dnsLookup,
  getNetworkInterfaces,
  testHttpEndpoint
} from '../src/network-tools.js';

// Mock child_process execFile
vi.mock('child_process', () => {
  return {
    execFile: vi.fn((path, args, callback) => {
      const toolName = path.split('/').pop();
      
      if (toolName === 'connectivity') {
        if (args[0] === '8.8.8.8' && args[1] === 'ping') {
          callback(null, JSON.stringify({
            success: true,
            target: '8.8.8.8',
            mode: 'ping',
            message: 'Host is reachable',
            rtt_ms: 45.2,
            packet_loss: 0
          }));
        } else if (args[0] === '8.8.8.8' && args[1] === 'tcp') {
          callback(null, JSON.stringify({
            success: true,
            target: '8.8.8.8',
            mode: 'tcp',
            port: parseInt(args[2]),
            message: 'Port is open',
            time_ms: 28.5
          }));
        } else {
          callback(null, JSON.stringify({
            success: false,
            target: args[0],
            mode: args[1],
            message: 'Connection failed'
          }));
        }
      } else if (toolName === 'http-test') {
        callback(null, JSON.stringify({
          url: args[0],
          success: true,
          status_code: 200,
          response_time: 150,
          content_length: 1024,
          headers: {
            'Content-Type': 'text/html'
          }
        }));
      } else if (toolName === 'port-scanner') {
        callback(null, JSON.stringify({
          target: args[0],
          ports: [
            { port: 53, status: 'open', service: 'domain' }
          ]
        }));
      } else if (toolName === 'traceroute') {
        callback(null, JSON.stringify({
          target: args[0],
          hops: [
            { hop: 1, host: '192.168.1.1', rtt: 5.2 },
            { hop: 2, host: '10.0.0.1', rtt: 15.6 }
          ]
        }));
      }
    })
  };
});

// Mock path and url modules
vi.mock('path', () => ({ 
  join: (...args) => args.join('/'),
  dirname: (p) => p.split('/').slice(0, -1).join('/')
}));
vi.mock('url', () => ({ 
  fileURLToPath: (url) => url.replace('file://', '') 
}));

describe('Network Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tests ping connectivity successfully', async () => {
    const result = await testConnectivity('8.8.8.8', { mode: 'ping' });
    expect(result.success).toBe(true);
    expect(result.target).toBe('8.8.8.8');
    expect(result.rtt_ms).toBeDefined();
  });

  it('tests TCP connectivity successfully', async () => {
    const result = await testConnectivity('8.8.8.8', { mode: 'tcp', port: 53 });
    expect(result.success).toBe(true);
    expect(result.port).toBe(53);
    expect(result.time_ms).toBeDefined();
  });

  it('handles connectivity failures gracefully', async () => {
    const result = await testConnectivity('192.0.2.1', { mode: 'ping' });
    expect(result.success).toBe(false);
  });

  it('tests HTTP endpoints successfully', async () => {
    const result = await testHttpEndpoint('https://www.example.com');
    expect(result.url).toBe('https://www.example.com');
    expect(result.success).toBe(true);
    expect(result.status_code).toBe(200);
    expect(result.response_time).toBeDefined();
  });

  it('scans ports successfully', async () => {
    const result = await scanPorts('8.8.8.8', '53-54');
    expect(result.target).toBe('8.8.8.8');
    expect(result.ports).toHaveLength(1);
    expect(result.ports[0].port).toBe(53);
  });

  it('performs traceroute successfully', async () => {
    const result = await traceroute('8.8.8.8');
    expect(result.target).toBe('8.8.8.8');
    expect(result.hops).toHaveLength(2);
    expect(result.hops[0].hop).toBe(1);
  });
});
