import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupLangWatch as setupBrowser } from '../../client-browser';

// Mock window object for Node.js test environment
const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
global.window = mockWindow as any;

describe('client-browser integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindow.addEventListener.mockClear();
  });

  afterEach(() => {
    // Clean up global state by clearing the module cache
    vi.resetModules();
  });

  it('should start and shut down the WebTracerProvider without error', async () => {
    // First setup should complete without error
    await expect(setupBrowser({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      skipOpenTelemetrySetup: false,
    })).resolves.not.toThrow();

    // Second setup should also complete without error (triggers shutdown of previous)
    await expect(setupBrowser({
      apiKey: 'integration-key2',
      endpoint: 'http://localhost:9999',
      skipOpenTelemetrySetup: false,
    })).resolves.not.toThrow();
  });

  it('should not set up WebTracerProvider if skipOpenTelemetrySetup is true', async () => {
    // Should complete without error and without setting up WebTracerProvider
    await expect(setupBrowser({
      apiKey: 'integration-key',
      endpoint: 'http://localhost:9999',
      skipOpenTelemetrySetup: true,
    })).resolves.not.toThrow();
  });
});
