import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { 
  createEC2Client, 
  getAllRegions, 
  getGovCloudRegions, 
  testCredentials 
} from '../src/aws/client.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-ec2', () => {
  return {
    EC2Client: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockImplementation((command) => {
        if (command.constructor.name === 'DescribeRegionsCommand') {
          return Promise.resolve({
            Regions: [
              { RegionName: 'us-east-1' },
              { RegionName: 'us-west-1' },
              { RegionName: 'us-gov-west-1' }
            ]
          });
        }
        return Promise.resolve({});
      })
    })),
    DescribeRegionsCommand: vi.fn()
  };
});

// Mock the credentials service
vi.mock('../src/services/credentials.js', () => {
  return {
    loadCredentials: vi.fn().mockResolvedValue({
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret'
    }),
    createCredentialProvider: vi.fn().mockReturnValue({})
  };
});

describe('AWS Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an EC2 client with the correct region', () => {
    const client = createEC2Client('us-west-2');
    expect(client).toBeDefined();
  });

  it('converts region to GovCloud when isGovCloud is true', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    createEC2Client('us-east-2', true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Converting us-east-2 to GovCloud region'));
    
    consoleSpy.mockRestore();
  });

  it('retrieves all regions', async () => {
    const regions = await getAllRegions();
    expect(regions).toContain('us-east-1');
    expect(regions).toContain('us-west-1');
    expect(regions).not.toContain('us-gov-west-1');
  });

  it('includes GovCloud regions when specified', async () => {
    const regions = await getAllRegions(true);
    expect(regions).toContain('us-east-1');
    expect(regions).toContain('us-west-1');
    expect(regions).toContain('us-gov-west-1');
  });

  it('retrieves GovCloud regions', async () => {
    const regions = await getGovCloudRegions();
    expect(regions).toContain('us-gov-west-1');
  });

  it('tests credentials successfully', async () => {
    const result = await testCredentials();
    expect(result).toBe(true);
  });
});
