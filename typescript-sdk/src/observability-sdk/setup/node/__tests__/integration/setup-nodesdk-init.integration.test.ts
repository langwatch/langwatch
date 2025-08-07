import { describe, it, expect, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { setupObservability } from '../../setup';
import { isConcreteProvider } from '../../../utils';

// Integration tests for NodeSDK initialization in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - NodeSDK Initialization', () => {
  it('should initialize NodeSDK when no global provider exists', async () => {
    const logger = createMockLogger();
    const handle = setupObservability({ apiKey: 'test-key', logger });
    expect(typeof handle.shutdown).toBe('function');

    // Check that the global tracer provider is no longer a no-op
    expect(isConcreteProvider(trace.getTracerProvider())).toBe(true);

    // Should be able to call shutdown without error
    await expect(handle.shutdown()).resolves.toBeUndefined();

    // Optionally, check that logger.info was called for NodeSDK init
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No existing TracerProvider; initializing NodeSDK'));
  });
});
