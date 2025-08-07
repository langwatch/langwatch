import { describe, it, expect, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { setupObservability } from '../../setup';
import { isConcreteProvider } from '../../../utils';

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
    const handle = setupObservability({ apiKey: 'test-key', logger });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry is already set up in this process'));
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
    // The global provider should still be concrete
    expect(isConcreteProvider(trace.getTracerProvider())).toBe(true);
  });
});
