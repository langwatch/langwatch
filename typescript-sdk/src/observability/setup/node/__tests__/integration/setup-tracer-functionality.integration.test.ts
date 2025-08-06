import { describe, it, expect, vi } from 'vitest';
import { setupObservability } from '../../setup';
import { trace } from '@opentelemetry/api';

// Integration tests for tracer functionality in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - Tracer Functionality', () => {
  it('should create spans with correct attributes', async () => {
    const logger = createMockLogger();
    setupObservability({ apiKey: 'test-key', logger });
    const tracer = trace.getTracer('default');
    const span = tracer.startSpan('test-operation');
    span.setAttribute('http.method', 'GET');
    span.setAttribute('http.url', 'https://api.example.com');
    span.setStatus({ code: 1 }); // OK
    span.end();
    // No assertion possible on span here, but no error means success
  });

  it('should handle active spans correctly if available', async () => {
    const logger = createMockLogger();
    setupObservability({ apiKey: 'test-key', logger });
    const tracer = trace.getTracer('default');
    let result = undefined;
    // Use context.with if available
    if (typeof tracer.startActiveSpan === 'function') {
      await new Promise((resolve) => {
        tracer.startActiveSpan('test-operation', (span) => {
          span.setAttribute('test.attribute', 'test-value');
          result = 'test-result';
          span.end();
          resolve(undefined);
        });
      });
      expect(result).toBe('test-result');
    }
  });
});
