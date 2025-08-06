import { describe, it, expect, vi } from 'vitest';
import { setupObservability } from '../../setup';

// Integration tests for shutdown behavior in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - Shutdown Behavior', () => {
  it('should provide a shutdown function that works', async () => {
    const logger = createMockLogger();
    const handle = setupObservability({ apiKey: 'test-key', logger });
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('should handle shutdown errors gracefully', async () => {
    const logger = createMockLogger();
    const handle = setupObservability({ apiKey: 'test-key', logger });
    // Mock shutdown to throw
    handle.shutdown = vi.fn().mockRejectedValue(new Error('Shutdown failed'));
    await expect(handle.shutdown()).rejects.toThrow('Shutdown failed');
  });
});
