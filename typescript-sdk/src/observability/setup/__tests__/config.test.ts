import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../../logger';

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

  it('setObservabilityConfig sets config only once', async () => {
    const config = await import('../config.ts');
    const logger = new MockLogger();
    config.setObservabilityConfig({ logger });
    expect(config.getObservabilityConfig().logger).toBe(logger);
    // Second call should log error and not overwrite
    const logger2 = new MockLogger();
    config.setObservabilityConfig({ logger: logger2 });
    expect(config.getObservabilityConfig().logger).toBe(logger);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('already set')
    );
  });

  it('getObservabilityConfig returns default if not set and logs error', async () => {
    const config = await import('../config.ts');
    // Do not set config
    const result = config.getObservabilityConfig();
    expect(result.logger.debug).toBeInstanceOf(Function);
    expect(result.logger.info).toBeInstanceOf(Function);
    expect(result.logger.warn).toBeInstanceOf(Function);
    expect(result.logger.error).toBeInstanceOf(Function);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Please call setupObservability')
    );
  });

  it('getObservabilityLogger returns logger from config', async () => {
    const config = await import('../config.ts');
    const logger = new MockLogger();
    config.setObservabilityConfig({ logger });
    expect(config.getObservabilityLogger()).toBe(logger);
  });
});
