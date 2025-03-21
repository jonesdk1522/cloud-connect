import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { testCredentials } from './credentials.js';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import * as credentialProviders from '@aws-sdk/credential-providers';

// src/services/credentials.test.js

// Mock AWS SDK clients and commands
vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: vi.fn(),
  GetCallerIdentityCommand: vi.fn()
}));

vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn(),
  DescribeRegionsCommand: vi.fn()
}));

// Mock AWS credential providers
vi.mock('@aws-sdk/credential-providers', () => ({
  fromEnv: vi.fn(),
  fromIni: vi.fn(),
  fromTemporaryCredentials: vi.fn(),
  fromWebToken: vi.fn(),
  fromInstanceMetadata: vi.fn()
}));

// Suppress console output
vi.mock('chalk', () => ({
  default: {
    yellow: vi.fn(text => text),
    green: vi.fn(text => text),
    red: vi.fn(text => text),
    cyan: vi.fn(text => text),
    blue: vi.fn(text => text)
  }
}));

describe('testCredentials', () => {
  // Store original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let mockSTSSend;
  let mockEC2Send;
  
  beforeEach(() => {
    // Suppress console output
    console.log = vi.fn();
    console.error = vi.fn();
    
    // Reset mocks
    vi.resetAllMocks();
    
    // Set up valid credential response
    const validCredential = {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    };
    
    // Setup credential provider mocks
    Object.values(credentialProviders).forEach(provider => {
      if (typeof provider === 'function') {
        provider.mockReturnValue(() => Promise.resolve(validCredential));
      }
    });
    
    // Mock successful STS response
    mockSTSSend = vi.fn().mockResolvedValue({
      Account: '123456789012',
      UserId: 'AIDAIOSFODNN7EXAMPLE',
      Arn: 'arn:aws:iam::123456789012:user/test-user'
    });
    
    STSClient.mockImplementation(() => ({
      send: mockSTSSend
    }));
    
    // Mock successful EC2 response
    mockEC2Send = vi.fn().mockResolvedValue({
      Regions: [{ RegionName: 'us-east-1' }]
    });
    
    EC2Client.mockImplementation(() => ({
      send: mockEC2Send
    }));
    
    // Mock the commands
    GetCallerIdentityCommand.mockImplementation(() => ({}));
    DescribeRegionsCommand.mockImplementation(() => ({}));
  });
  
  afterEach(() => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });
  
  it('should succeed with valid access key credentials', async () => {
    const credentials = {
      method: 'access-keys',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      isGovCloud: false
    };
    
    const result = await testCredentials(credentials);
    
    expect(result).toBe(true);
    expect(STSClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'us-east-1'
    }));
    expect(mockSTSSend).toHaveBeenCalled();
  });
  
  it('should succeed with valid profile credentials', async () => {
    const credentials = {
      method: 'profile',
      profile: 'default',
      isGovCloud: false
    };
    
    const result = await testCredentials(credentials);
    
    expect(result).toBe(true);
    expect(credentialProviders.fromIni).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'default' })
    );
  });
  
  it('should succeed with valid role credentials', async () => {
    const credentials = {
      method: 'role',
      roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      sessionName: 'test-session',
      sourceCredentials: { type: 'environment' },
      isGovCloud: false
    };
    
    const result = await testCredentials(credentials);
    
    expect(result).toBe(true);
    expect(credentialProviders.fromTemporaryCredentials).toHaveBeenCalled();
  });
  
  it('should use correct region for GovCloud credentials', async () => {
    const credentials = {
      method: 'access-keys',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      isGovCloud: true,
      govCloudRegion: 'us-gov-west-1'
    };
    
    const result = await testCredentials(credentials);
    
    expect(result).toBe(true);
    expect(STSClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'us-gov-west-1'
    }));
  });
  
  it('should fail when STS returns an error', async () => {
    // Make STS call fail
    mockSTSSend.mockRejectedValue(new Error('Invalid credentials'));
    
    const credentials = {
      method: 'access-keys',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      isGovCloud: false
    };
    
    const result = await testCredentials(credentials);
    
    expect(result).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('❌ Credential validation failed')
    );
  });
  
  it('should fail when credential provider returns invalid object', async () => {
    // Simulate the "Resolved credential object is not valid" error
    credentialProviders.fromEnv.mockReturnValue(() => Promise.resolve(null));
    
    const credentials = {
      method: 'access-keys',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      isGovCloud: false
    };
    
    const result = await testCredentials(credentials);
    
    expect(result).toBe(false);
  });
  
  it('should succeed even when EC2 validation fails', async () => {
    // STS succeeds but EC2 fails
    mockEC2Send.mockRejectedValue(new Error('EC2 access denied'));
    
    const credentials = {
      method: 'access-keys',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      isGovCloud: false
    };
    
    const result = await testCredentials(credentials);
    
    // Should still succeed because STS validation passed
    expect(result).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('⚠️ EC2 permissions check failed')
    );
  });
});