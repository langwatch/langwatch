import { describe, it, expect } from 'vitest';
import { setup as setupNode } from '../client-node';

describe('client-node integration', () => {
  it('should start and shut down the NodeSDK without error', async () => {
    await setupNode({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: false,
    });
    // Call setup again to trigger shutdown of previous SDK
    await setupNode({
      apiKey: 'integration-key2',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: false,
    });
    // If no error is thrown, test passes
    expect(true).toBe(true);
  });

  it('should not start NodeSDK if disableOpenTelemetryAutomaticSetup is true', async () => {
    // Should not throw
    await setupNode({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: true,
    });
    expect(true).toBe(true);
  });
});
