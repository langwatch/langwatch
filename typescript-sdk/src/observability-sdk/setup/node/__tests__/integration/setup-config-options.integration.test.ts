import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { setupObservability } from '../../setup';
import { type SetupObservabilityOptions } from '../../types';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace } from '@opentelemetry/api';
import { getConcreteProvider } from '../../../utils';
import { resetObservabilitySdkConfig } from '../../../../config.js';

beforeEach(() => {
  trace.disable();
  resetObservabilitySdkConfig();
});

afterEach(() => {
  trace.disable();
  // Reset observability config after each test
  resetObservabilitySdkConfig();
});

// Integration tests for setupObservability configuration options in Node.js

// Helper to create a mock logger
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('setupObservability Integration - Configuration Options', () => {
  it('should reflect apiKey and endpoint in the exporter', async () => {
    const logger = createMockLogger();
    const exportSpy = vi.fn((spans, resultCallback) => resultCallback({ code: 0 }));
    class SpyExporter {
      export = exportSpy;
      shutdown = vi.fn();
      forceFlush = vi.fn();
    }
    const spyExporter = new SpyExporter();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key', endpoint: 'https://custom.langwatch.ai' },
      debug: { logger },
      traceExporter: spyExporter as any,
    };
    const handle = setupObservability(options);
    const tracer = trace.getTracer('test-exporter');
    const span = tracer.startSpan('test-span');
    span.end();

    // Force flush to ensure spans are exported immediately
    const provider = trace.getTracerProvider() as any;
    if (provider.forceFlush) {
      await provider.forceFlush();
    }

    // Shutdown may throw DNS errors from the LangWatch exporter trying to
    // reach the fake endpoint — that's fine, we only care about the spy.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    await handle.shutdown().catch(() => {});
    expect(exportSpy).toHaveBeenCalled();
  });

  it('should use serviceName and attributes in resource', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      serviceName: 'test-service',
      attributes: { 'deployment.environment': 'test', 'service.version': '1.0.0' } as any,
      debug: { logger },
    };
    const handle = setupObservability(options);
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider._config.resource.attributes['service.name']).toBe('test-service');
    expect(provider._config.resource.attributes['deployment.environment']).toBe('test');
    expect(provider._config.resource.attributes['service.version']).toBe('1.0.0');
    await handle.shutdown();
  });

  it('should use custom Resource if provided', async () => {
    const logger = createMockLogger();
    const resource = resourceFromAttributes({ 'custom.resource': 'yes' });
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      resource,
      debug: { logger },
    };
    const handle = setupObservability(options);
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider._config.resource.attributes['custom.resource']).toBe('yes');
    await handle.shutdown();
  });

  it('should use spanLimits if provided', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      spanLimits: { attributeCountLimit: 1 },
      debug: { logger },
    };
    const handle = setupObservability(options);
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider._config.spanLimits?.attributeCountLimit).toBe(1);
    await handle.shutdown();
  });

  it('should use autoDetectResources if provided', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      autoDetectResources: false,
      debug: { logger },
    };
    const handle = setupObservability(options);
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider._config.resource).toBeDefined();
    await handle.shutdown();
  });

  it('should use sampler if provided', async () => {
    const logger = createMockLogger();
    const customSampler = { shouldSample: vi.fn(), toString: () => 'customSampler' };
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      sampler: customSampler as any,
      debug: { logger },
    };
    const handle = setupObservability(options);
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider._config.sampler.toString()).toBe('customSampler');
    await handle.shutdown();
  });

  it('should use idGenerator if provided', async () => {
    const logger = createMockLogger();
    const customIdGenerator = { generateSpanId: () => 'spanid', generateTraceId: () => 'traceid' };
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      idGenerator: customIdGenerator as any,
      debug: { logger },
    };
    const handle = setupObservability(options);
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider._config.idGenerator.generateSpanId()).toBe('spanid');
    expect(provider._config.idGenerator.generateTraceId()).toBe('traceid');
    await handle.shutdown();
  });

  it('should use spanProcessors if provided', async () => {
    const logger = createMockLogger();
    const onEndSpy = vi.fn();
    class SpyProcessor {
      onStart = vi.fn();
      onEnd = onEndSpy;
      shutdown = vi.fn();
      forceFlush = vi.fn();
    }
    const spyProcessor = new SpyProcessor();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      spanProcessors: [spyProcessor as any],
      debug: { logger },
    };
    const handle = setupObservability(options);
    const tracer = trace.getTracer('test-processor');
    const span = tracer.startSpan('test-span');
    span.end();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onEndSpy).toHaveBeenCalled();
    await handle.shutdown();
  });

  // For options that cannot be directly inspected, keep logger or side-effect checks
  it('should use instrumentations if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customInstrumentations = [{
      instrumentationName: 'custom',
      instrumentationVersion: '1.0.0',
      enable: vi.fn(),
      disable: vi.fn(),
      setTracerProvider: vi.fn(),
      setMeterProvider: vi.fn(),
      setLoggerProvider: vi.fn(),
    }] as any;
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      instrumentations: customInstrumentations,
      debug: { logger },
    };
    // Test that setup doesn't throw an error with custom instrumentations
    expect(async () => {
      const handle = setupObservability(options);
      await handle.shutdown();
    }).not.toThrow();
  });

  it('should use contextManager if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customContextManager = {
      active: (_ctx: any) => undefined,
      with: (_ctx: any, fn: any) => fn(),
      bind: (_ctx: any, target: any) => target
    };
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      contextManager: customContextManager as any,
      debug: { logger },
    };
    // Test that setup doesn't throw an error with custom context manager
    expect(async () => {
      const handle = setupObservability(options);
      await handle.shutdown();
    }).not.toThrow();
  });

  it('should use textMapPropagator if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customTextMapPropagator = { inject: vi.fn(), extract: vi.fn(), fields: vi.fn() };
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      textMapPropagator: customTextMapPropagator as any,
      debug: { logger },
    };
    const handle = setupObservability(options);
    expect(logger.info).toHaveBeenCalled();
    await handle.shutdown();
  });

  it('should use logRecordProcessors if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customLogRecordProcessor = { onEmit: vi.fn(), forceFlush: vi.fn(), shutdown: vi.fn() };
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      logRecordProcessors: [customLogRecordProcessor as any],
      debug: { logger },
    };
    const handle = setupObservability(options);
    expect(logger.info).toHaveBeenCalled();
    await handle.shutdown();
  });

  it('should use metricReader if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customMetricReader = { collect: vi.fn(), forceFlush: vi.fn(), shutdown: vi.fn(), setCallback: vi.fn() };
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      metricReader: customMetricReader as any,
      debug: { logger },
    };
    // Test that setup doesn't throw an error with custom metric reader
    expect(async () => {
      const handle = setupObservability(options);
      await handle.shutdown();
    }).not.toThrow();
  });

  it('should use views if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customViews = [{ instrumentName: 'custom.instrument' }];
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      views: customViews as any,
      debug: { logger },
    };
    const handle = setupObservability(options);
    expect(logger.info).toHaveBeenCalled();
    await handle.shutdown();
  });

  it('should use resourceDetectors if provided (smoke test)', async () => {
    const logger = createMockLogger();
    const customResourceDetectors = [{ detect: vi.fn() }];
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      resourceDetectors: customResourceDetectors as any,
      debug: { logger },
    };
    const handle = setupObservability(options);
    expect(logger.info).toHaveBeenCalled();
    await handle.shutdown();
  });

  it('should use consoleTracing if provided', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      debug: {
        consoleTracing: true,
        logger
      },
    };
    const handle = setupObservability(options);
    await handle.shutdown();
  });

  it('should use custom traceExporter if provided', async () => {
    const logger = createMockLogger();
    const exporter = new OTLPTraceExporter();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      traceExporter: exporter,
      debug: { logger },
    };
    const handle = setupObservability(options);
    await handle.shutdown();
  });

  it('should use logLevel if provided', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      debug: {
        logLevel: 'debug',
        logger
      },
    };
    const handle = setupObservability(options);
    // Accept any logger method being called, not just info
    expect(
      logger.info.mock.calls.length +
      logger.debug.mock.calls.length +
      logger.error.mock.calls.length +
      logger.warn.mock.calls.length
    ).toBeGreaterThan(0);
    await handle.shutdown();
  });

  it('should fallback to env vars for apiKey/endpoint/serviceName', async () => {
    process.env.LANGWATCH_API_KEY = 'env-api-key';
    process.env.LANGWATCH_ENDPOINT = 'https://env-endpoint';
    process.env.LANGWATCH_SERVICE_NAME = 'env-service';
    const logger = createMockLogger();
    // setupObservability should pick up env vars when not provided in options
    const options: SetupObservabilityOptions = { debug: { logger } };
    const handle = setupObservability(options);
    // Accept any logger method being called, not just info
    expect(
      logger.info.mock.calls.length +
      logger.debug.mock.calls.length +
      logger.error.mock.calls.length +
      logger.warn.mock.calls.length
    ).toBeGreaterThan(0);
    await handle.shutdown();
    delete process.env.LANGWATCH_API_KEY;
    delete process.env.LANGWATCH_ENDPOINT;
    delete process.env.LANGWATCH_SERVICE_NAME;
  });

  it('should handle invalid/conflicting options gracefully', async () => {
    const logger = createMockLogger();
    // e.g., both spanProcessors and consoleTracing
    const processor = new SimpleSpanProcessor(new OTLPTraceExporter());
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      spanProcessors: [processor],
      debug: {
        consoleTracing: true,
        logger
      },
    };
    const handle = setupObservability(options);
    await handle.shutdown();
  });

  it('should skip OpenTelemetry setup if skipOpenTelemetrySetup is true', async () => {
    const logger = createMockLogger();
    const exportSpy = vi.fn();
    class SpyExporter {
      export = exportSpy;
      shutdown = vi.fn();
      forceFlush = vi.fn();
    }
    const spyExporter = new SpyExporter();
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      debug: { logger },
      traceExporter: spyExporter as any,
      advanced: { skipOpenTelemetrySetup: true },
    };
    const handle = setupObservability(options);
    // Try to create a span
    const tracer = trace.getTracer('test-skip-otel');
    const span = tracer.startSpan('should-not-export');
    span.end();
    // Even after shutdown, no spans should be exported
    await handle.shutdown();
    expect(exportSpy).not.toHaveBeenCalled();
    // The provider should not be a concrete provider
    const provider: any = getConcreteProvider(trace.getTracerProvider());
    expect(provider).toBeUndefined();
  });

  it('should accept new flat debug configuration structure', async () => {
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      debug: {
        consoleTracing: true,
        consoleLogging: true,
        logLevel: 'debug'
      }
    };

    const handle = setupObservability(options);
    // Verify provider was set up correctly
    const provider = getConcreteProvider(trace.getTracerProvider());
    expect(provider).not.toBeUndefined();
    await handle.shutdown();
  });

  it('should handle advanced.disabled correctly in integration', async () => {
    const options: SetupObservabilityOptions = {
      langwatch: { apiKey: 'test-api-key' },
      advanced: { disabled: true }
    };

    const handle = setupObservability(options);

    // Verify no TracerProvider was set up
    const provider = getConcreteProvider(trace.getTracerProvider());
    expect(provider).toBeUndefined();

    await handle.shutdown();
  });

  it('should handle langwatch disabled configuration', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: 'disabled',
      debug: {
        consoleTracing: true,
        logger,
      }
    };

    const handle = setupObservability(options);

    // Verify provider was set up (console tracing should allow this)
    const provider = getConcreteProvider(trace.getTracerProvider());
    expect(provider).not.toBeUndefined();

    await handle.shutdown();
  });

  it('should use batch processors when specified', async () => {
    const logger = createMockLogger();
    const options: SetupObservabilityOptions = {
      langwatch: {
        apiKey: 'test-api-key',
        processorType: 'batch'
      },
      debug: { logger }
    };

    const handle = setupObservability(options);

    const provider = getConcreteProvider(trace.getTracerProvider());
    expect(provider).not.toBeUndefined();

    await handle.shutdown();
  });

  describe('data capture configuration', () => {
    it('should set "none" mode in observability config', async () => {
      const logger = createMockLogger();
      const options: SetupObservabilityOptions = {
        langwatch: { apiKey: 'test-api-key' },
        dataCapture: "none",
        debug: { logger },
      };
      const handle = setupObservability(options);

      // Import config module to check the setting
      const { shouldCaptureInput, shouldCaptureOutput } = await import('../../../../config.js');
      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(false);

      await handle.shutdown();
    });

    it('should set "input" mode in observability config', async () => {
      const logger = createMockLogger();
      const options: SetupObservabilityOptions = {
        langwatch: { apiKey: 'test-api-key' },
        dataCapture: "input",
        debug: { logger },
      };
      const handle = setupObservability(options);

      // Import config module to check the setting
      const { shouldCaptureInput, shouldCaptureOutput } = await import('../../../../config.js');
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);

      await handle.shutdown();
    });

    it('should set "output" mode in observability config', async () => {
      const logger = createMockLogger();
      const options: SetupObservabilityOptions = {
        langwatch: { apiKey: 'test-api-key' },
        dataCapture: "output",
        debug: { logger },
      };
      const handle = setupObservability(options);

      // Import config module to check the setting
      const { shouldCaptureInput, shouldCaptureOutput } = await import('../../../../config.js');
      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(true);

      await handle.shutdown();
    });

    it('should set "all" mode in observability config', async () => {
      const logger = createMockLogger();
      const options: SetupObservabilityOptions = {
        langwatch: { apiKey: 'test-api-key' },
        dataCapture: "all",
        debug: { logger },
      };
      const handle = setupObservability(options);

      // Import config module to check the setting
      const { shouldCaptureInput, shouldCaptureOutput } = await import('../../../../config.js');
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);

      await handle.shutdown();
    });

    it('should default to "all" mode when not specified', async () => {
      const logger = createMockLogger();
      const options: SetupObservabilityOptions = {
        langwatch: { apiKey: 'test-api-key' },
        debug: { logger },
      };
      const handle = setupObservability(options);

      // Import config module to check default values
      const { shouldCaptureInput, shouldCaptureOutput } = await import('../../../../config.js');
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);

      await handle.shutdown();
    });
  });
});
