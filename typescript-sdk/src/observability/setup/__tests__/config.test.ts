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

  it('getObservabilityConfigSuppressInputCapture returns false by default', async () => {
    const config = await import('../config.ts');
    const logger = new MockLogger();
    config.setObservabilityConfig({ logger });
    expect(config.getObservabilityConfigSuppressInputCapture()).toBe(false);
  });

  it('getObservabilityConfigSuppressInputCapture returns configured value', async () => {
    const config = await import('../config.ts');
    const logger = new MockLogger();
    config.setObservabilityConfig({ logger, suppressInputCapture: true });
    expect(config.getObservabilityConfigSuppressInputCapture()).toBe(true);
  });

  it('getObservabilityConfigSuppressOutputCapture returns false by default', async () => {
    const config = await import('../config.ts');
    const logger = new MockLogger();
    config.setObservabilityConfig({ logger });
    expect(config.getObservabilityConfigSuppressOutputCapture()).toBe(false);
  });

  it('getObservabilityConfigSuppressOutputCapture returns configured value', async () => {
    const config = await import('../config.ts');
    const logger = new MockLogger();
    config.setObservabilityConfig({ logger, suppressOutputCapture: true });
    expect(config.getObservabilityConfigSuppressOutputCapture()).toBe(true);
  });

  it('suppress capture functions work with default config when not set', async () => {
    const config = await import('../config.ts');
    // Do not set config, use default
    expect(config.getObservabilityConfigSuppressInputCapture()).toBe(false);
    expect(config.getObservabilityConfigSuppressOutputCapture()).toBe(false);
  });
});
