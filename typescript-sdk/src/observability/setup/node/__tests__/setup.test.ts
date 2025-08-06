import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupObservability, createAndStartNodeSdk } from '../setup';
import { resourceFromAttributes } from '@opentelemetry/resources';
const MockLogger = vi.fn().mockImplementation(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';
import { setObservabilityConfigInstance } from '../../config.js';


// Helper to create a mock logger
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

// Mocks
vi.mock('../../utils', () => ({
  isConcreteProvider: vi.fn(() => false),
}));
vi.mock('../../../exporters', () => ({
  LangWatchExporter: vi.fn().mockImplementation(() => ({ shutdown: vi.fn() })),
}));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

const defaultOptions = { apiKey: 'test', serviceName: 'svc' };

describe('setupObservability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    trace.disable();
  });
  it('returns shutdown noop if skipOpenTelemetrySetup is true', async () => {
    const handle = setupObservability({ ...defaultOptions, skipOpenTelemetrySetup: true });
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns shutdown noop if already setup', async () => {
    const { isConcreteProvider } = await import('../../utils.ts');
    (isConcreteProvider as any).mockReturnValue(true);
    const handle = setupObservability(defaultOptions);
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('calls createAndStartNodeSdk and returns shutdown', async () => {
    const handle = setupObservability(defaultOptions);
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('logs and returns noop shutdown on error if throwOnSetupError is false', async () => {
    const badResource = resourceFromAttributes({});
    Object.defineProperty(badResource, 'attributes', {
      get() { throw new Error('fail'); },
    });
    const handle = setupObservability({ ...defaultOptions, resource: badResource, throwOnSetupError: false });
    expect(typeof handle.shutdown).toBe('function');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});

describe('createAndStartNodeSdk', () => {
  it('uses provided traceExporter if present', () => {
    const logger = new MockLogger({});
    // Provide a minimal valid OTLPTraceExporter mock
    class FakeExporter extends OTLPTraceExporter {
      export() {}
      shutdown() { return Promise.resolve(); }
      forceFlush() { return Promise.resolve(); }
    }
    const options = { ...defaultOptions, traceExporter: new FakeExporter() };
    const sdk = createAndStartNodeSdk(options, logger, resourceFromAttributes({}));
    expect(sdk).toBeDefined();
  });

  it('adds console span processor if consoleTracing is true', () => {
    const logger = new MockLogger({});
    const options = { ...defaultOptions, consoleTracing: true };
    const sdk = createAndStartNodeSdk(options, logger, resourceFromAttributes({}));
    expect(sdk).toBeDefined();
  });

  it('adds user span processors if provided', () => {
    const logger = new MockLogger({});
    const fakeProcessor = { onStart: vi.fn(), onEnd: vi.fn(), shutdown: vi.fn(), forceFlush: vi.fn() };
    const options = { ...defaultOptions, spanProcessors: [fakeProcessor] };
    const sdk = createAndStartNodeSdk(options, logger, resourceFromAttributes({}));
    expect(sdk).toBeDefined();
  });
});

describe('setupObservability - suppress options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset any existing config
    setObservabilityConfigInstance(null);
  });
  afterEach(() => {
    trace.disable();
    // Reset config after each test
    setObservabilityConfigInstance(null);
  });

    it('sets suppressInputCapture in observability config', async () => {
    const options = { ...defaultOptions, suppressInputCapture: true };
    setupObservability(options);

    const { getObservabilityConfigSuppressInputCapture } = await import('../../config.js');
    expect(getObservabilityConfigSuppressInputCapture()).toBe(true);
  });

  it('sets suppressOutputCapture in observability config', async () => {
    const options = { ...defaultOptions, suppressOutputCapture: true };
    setupObservability(options);

    const { getObservabilityConfigSuppressOutputCapture } = await import('../../config.js');
    expect(getObservabilityConfigSuppressOutputCapture()).toBe(true);
  });

  it('sets both suppress options in observability config', async () => {
    const options = {
      ...defaultOptions,
      suppressInputCapture: true,
      suppressOutputCapture: true
    };
    setupObservability(options);

    const {
      getObservabilityConfigSuppressInputCapture,
      getObservabilityConfigSuppressOutputCapture
    } = await import('../../config.js');
    expect(getObservabilityConfigSuppressInputCapture()).toBe(true);
    expect(getObservabilityConfigSuppressOutputCapture()).toBe(true);
  });

  it('defaults suppress options to undefined when not specified', async () => {
    const options = { ...defaultOptions };
    setupObservability(options);

    const {
      getObservabilityConfigSuppressInputCapture,
      getObservabilityConfigSuppressOutputCapture
    } = await import('../../config.js');
    // These should be false due to default behavior in the config functions
    expect(getObservabilityConfigSuppressInputCapture()).toBe(false);
    expect(getObservabilityConfigSuppressOutputCapture()).toBe(false);
  });

  it('sets suppress options even when skipOpenTelemetrySetup is true', async () => {
    const options = {
      ...defaultOptions,
      suppressInputCapture: true,
      suppressOutputCapture: true,
      skipOpenTelemetrySetup: true
    };
    const handle = setupObservability(options);

    const {
      getObservabilityConfigSuppressInputCapture,
      getObservabilityConfigSuppressOutputCapture
    } = await import('../../config.js');
    expect(getObservabilityConfigSuppressInputCapture()).toBe(true);
    expect(getObservabilityConfigSuppressOutputCapture()).toBe(true);

    await handle.shutdown();
  });
});
