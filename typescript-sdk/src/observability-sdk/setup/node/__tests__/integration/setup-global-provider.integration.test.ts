import { describe, it, expect, vi, afterEach } from 'vitest';
import { trace } from '@opentelemetry/api';
import { setupObservability } from '../../setup';
import { isConcreteProvider } from '../../../utils';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

afterEach(() => {
  trace.disable();
});

function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - Existing Global Provider', () => {
  it('detects a real global provider and returns no-op', async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const logger = createMockLogger();

    const handle = setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry is already set up in this process'));
    await expect(handle.shutdown()).resolves.toBeUndefined();
    expect(isConcreteProvider(trace.getTracerProvider())).toBe(true);
  });
});

describe('setupObservability Integration - attachToExistingProvider', () => {
  it('attaches LangWatch processor to real NodeTracerProvider', async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const processorsBefore = (provider as any)._activeSpanProcessor._spanProcessors.length;
    const logger = createMockLogger();

    const handle = setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger },
      advanced: { attachToExistingProvider: true },
    });

    const processorsAfter = (provider as any)._activeSpanProcessor._spanProcessors.length;
    expect(processorsAfter).toBe(processorsBefore + 1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Attached LangWatch span processor to existing global provider')
    );
    expect(logger.error).not.toHaveBeenCalled();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns no-op when attachToExistingProvider is false (default)', async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const processorsBefore = (provider as any)._activeSpanProcessor._spanProcessors.length;
    const logger = createMockLogger();

    setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger },
    });

    const processorsAfter = (provider as any)._activeSpanProcessor._spanProcessors.length;
    expect(processorsAfter).toBe(processorsBefore);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('OpenTelemetry is already set up in this process')
    );
  });

  it('does not attach when LangWatch is disabled', async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const processorsBefore = (provider as any)._activeSpanProcessor._spanProcessors.length;
    const logger = createMockLogger();

    setupObservability({
      langwatch: 'disabled',
      debug: { logger },
      advanced: { attachToExistingProvider: true },
    });

    const processorsAfter = (provider as any)._activeSpanProcessor._spanProcessors.length;
    expect(processorsAfter).toBe(processorsBefore);
  });

  it('attaches user-provided span processors to real provider', async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const processorsBefore = (provider as any)._activeSpanProcessor._spanProcessors.length;
    const logger = createMockLogger();
    const customProcessor = { onStart: vi.fn(), onEnd: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined), forceFlush: vi.fn() };

    const handle = setupObservability({
      langwatch: { apiKey: 'test-key' },
      spanProcessors: [customProcessor as any],
      debug: { logger },
      advanced: { attachToExistingProvider: true },
    });

    const processorsAfter = (provider as any)._activeSpanProcessor._spanProcessors.length;
    expect(processorsAfter).toBe(processorsBefore + 2);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
