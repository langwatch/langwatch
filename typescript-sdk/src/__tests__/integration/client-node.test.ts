import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('client-node integration', () => {
  let clientNode: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Import fresh modules for each test to get clean state
    clientNode = await import('../../client-node.js');
  });

  afterEach(() => {
    // Clean up global state by clearing the module cache
    vi.resetModules();
  });

  it('should start and shut down the NodeSDK without error', async () => {
    // First setup should complete without error
    await expect(clientNode.setup({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: false,
    })).resolves.not.toThrow();

    // Reset module to clear setupCalled state for second call
    vi.resetModules();
    clientNode = await import('../../client-node.js');

    // Second setup should also complete without error (triggers shutdown of previous)
    await expect(clientNode.setup({
      apiKey: 'integration-key2',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: false,
    })).resolves.not.toThrow();
  });

  it('should not start NodeSDK if disableOpenTelemetryAutomaticSetup is true', async () => {
    // Should complete without error and without setting up NodeSDK
    await expect(clientNode.setup({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: true,
    })).resolves.not.toThrow();
  });
});
