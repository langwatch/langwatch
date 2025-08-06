import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupObservability } from '../../setup';
import { trace } from '@opentelemetry/api';

// Integration tests for error handling in setupObservability

afterEach(() => {
  trace.disable();
});

// Helper to create a mock logger
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - Error Handling', () => {
  it('should log and return no-op shutdown if NodeSDK init fails', async () => {
    const logger = createMockLogger();
    // Pass an invalid resource to force NodeSDK to throw
    const handle = setupObservability({
      apiKey: 'test-key',
      logger,
      resource: 123 as any, // Intentionally invalid
    });

    // Check that logger.error was called with a message containing the expected string
    const errorCalls = logger.error.mock.calls.map(call => call[0]);
    expect(errorCalls.some(msg => msg.includes('Failed to initialize NodeSDK'))).toBe(true);
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('should throw if throwOnSetupError is true', () => {
    const logger = createMockLogger();
    // Pass an invalid resource to force NodeSDK to throw
    const call = () => setupObservability({
      apiKey: 'test-key',
      logger,
      throwOnSetupError: true,
      resource: 123 as any, // Intentionally invalid
    });
    expect(call).toThrow();
  });
});
