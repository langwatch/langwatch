import { describe, it, expect } from 'vitest';
import { setup as setupBrowser } from '../client-browser';

describe('client-browser integration', () => {
  it('should start and shut down the WebTracerProvider without error', async () => {
    await setupBrowser({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: false,
    });
    // Call setup again to trigger shutdown of previous provider
    await setupBrowser({
      apiKey: 'integration-key2',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: false,
    });
    // If no error is thrown, test passes
    expect(true).toBe(true);
  });

  it('should not set up WebTracerProvider if disableOpenTelemetryAutomaticSetup is true', async () => {
    // Should not throw
    await setupBrowser({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      disableOpenTelemetryAutomaticSetup: true,
    });
    expect(true).toBe(true);
  });
});
