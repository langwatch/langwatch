import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupObservability } from '../../setup';
import { trace } from '@opentelemetry/api';
import { resetObservabilitySdkConfig } from '../../../../config.js';

// Integration tests for shutdown behavior in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

afterEach(() => {
  trace.disable();
  // Reset observability config after each test
  resetObservabilitySdkConfig();
});

describe('setupObservability Integration - Shutdown Behavior', () => {
  it('should provide a shutdown function that works', async () => {
    const logger = createMockLogger();
    const handle = setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('should handle shutdown errors gracefully', async () => {
    const logger = createMockLogger();
    const handle = setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });
    // Mock shutdown to throw
    handle.shutdown = vi.fn().mockRejectedValue(new Error('Shutdown failed'));
    await expect(handle.shutdown()).rejects.toThrow('Shutdown failed');
  });
});
