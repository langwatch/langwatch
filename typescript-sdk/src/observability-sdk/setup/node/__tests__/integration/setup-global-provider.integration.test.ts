import { describe, it, expect, vi, afterEach } from 'vitest';
import { trace } from '@opentelemetry/api';
import { setupObservability } from '../../setup';
import { isConcreteProvider } from '../../../utils';

afterEach(() => {
  trace.disable();
});

function createTestProvider() {
  return {
    getTracer: vi.fn(),
    addSpanProcessor: vi.fn(),
    register: vi.fn(),
    constructor: { name: 'NodeTracerProvider' },
  };
}

// Integration tests for setupObservability with an existing global provider
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - Existing Global Provider', () => {
  it('should detect a real global provider and not re-initialize NodeSDK', async () => {
    const globalProvider = createTestProvider();
    trace.setGlobalTracerProvider(globalProvider as any);
    const logger = createMockLogger();
    const handle = setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry is already set up in this process'));
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
    // The global provider should still be concrete
    expect(isConcreteProvider(trace.getTracerProvider())).toBe(true);
  });
});

describe('setupObservability Integration - attachToExistingProvider', () => {
  it('attaches LangWatch processor to existing provider when enabled', async () => {
    const existingProvider = createTestProvider();
    trace.setGlobalTracerProvider(existingProvider as any);
    const logger = createMockLogger();

    const handle = setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger },
      advanced: { attachToExistingProvider: true },
    });

    expect(existingProvider.addSpanProcessor).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Attached LangWatch span processor to existing global provider')
    );
    expect(logger.error).not.toHaveBeenCalled();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns no-op when attachToExistingProvider is false (default behavior)', async () => {
    const existingProvider = createTestProvider();
    trace.setGlobalTracerProvider(existingProvider as any);
    const logger = createMockLogger();

    setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger },
    });

    expect(existingProvider.addSpanProcessor).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('OpenTelemetry is already set up in this process')
    );
  });

  it('does not attach when LangWatch is disabled', async () => {
    const existingProvider = createTestProvider();
    trace.setGlobalTracerProvider(existingProvider as any);
    const logger = createMockLogger();

    setupObservability({
      langwatch: 'disabled',
      debug: { logger },
      advanced: { attachToExistingProvider: true },
    });

    expect(existingProvider.addSpanProcessor).not.toHaveBeenCalled();
  });

  it('attaches user-provided span processors to existing provider', async () => {
    const existingProvider = createTestProvider();
    trace.setGlobalTracerProvider(existingProvider as any);
    const logger = createMockLogger();
    const customProcessor = { onStart: vi.fn(), onEnd: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined), forceFlush: vi.fn() };

    const handle = setupObservability({
      langwatch: { apiKey: 'test-key' },
      spanProcessors: [customProcessor as any],
      debug: { logger },
      advanced: { attachToExistingProvider: true },
    });

    expect(existingProvider.addSpanProcessor).toHaveBeenCalledTimes(2);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
