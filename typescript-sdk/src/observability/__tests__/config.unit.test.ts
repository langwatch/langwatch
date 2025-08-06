import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../logger';

class MockLogger implements Logger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('config.ts', () => {
  let originalConsoleError: any;
  beforeEach(() => {
    vi.resetModules();
    originalConsoleError = console.error;
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('initializeObservabilitySdkConfig sets config any number of times', async () => {
    const config = await import('../config.js');
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const logger = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger });
    expect(config.getObservabilitySdkLogger()).toBe(logger);

    // Second call should overwrite
    const logger2 = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger: logger2 });
    expect(config.getObservabilitySdkLogger()).toBe(logger2);
  });

  it('getObservabilitySdkLogger works after config is set', async () => {
    const config = await import('../config.js');
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const logger = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger });
    expect(config.getObservabilitySdkLogger()).toBe(logger);
  });

  it('getObservabilitySdkConfig returns default when not initialized', async () => {
    const config = await import('../config.js');
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const result = config.getObservabilitySdkConfig({ throwOnUninitialized: true });
    expect(result.logger).toBeInstanceOf((await import('../../logger/index.js')).NoOpLogger);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Please call setupObservability')
    );
  });

  it('getObservabilitySdkConfig returns actual config when initialized', async () => {
    const config = await import('../config.js');
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const logger = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger });

    const result = config.getObservabilitySdkConfig();
    expect(result.logger).toBe(logger);
  });
});
