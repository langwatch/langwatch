import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as clientBrowser from '../client-browser';
import * as client from '../client';

vi.mock('@opentelemetry/sdk-trace-web', () => ({
  WebTracerProvider: vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts;
    this.register = vi.fn();
    this.shutdown = vi.fn();
  }),
  BatchSpanProcessor: vi.fn().mockImplementation((exporter) => ({ exporter }))
}));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn().mockImplementation((opts) => opts)
}));
vi.mock('@opentelemetry/context-zone', () => ({
  ZoneContextManager: vi.fn().mockImplementation(() => ({}))
}));
vi.mock('@opentelemetry/propagator-b3', () => ({
  B3Propagator: vi.fn().mockImplementation(() => ({}))
}));

describe('client-browser setup', () => {
  let WebTracerProvider: any;
  let BatchSpanProcessor: any;
  let OTLPTraceExporter: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    client.setConfig({ apiKey: undefined, endpoint: undefined });

    // Import the mocked modules before each test to get fresh spies
    const sdkTraceWeb = await vi.importMock<any>('@opentelemetry/sdk-trace-web');
    WebTracerProvider = sdkTraceWeb.WebTracerProvider;
    BatchSpanProcessor = sdkTraceWeb.BatchSpanProcessor;
    const otlpExporter = await vi.importMock<any>('@opentelemetry/exporter-trace-otlp-http');
    OTLPTraceExporter = otlpExporter.OTLPTraceExporter;
  });

  it('calls setConfig and sets up WebTracerProvider with correct options', async () => {
    await clientBrowser.setup({ apiKey: 'abc', endpoint: 'https://foo', disableOpenTelemetryAutomaticSetup: false });
    expect(WebTracerProvider).toHaveBeenCalledTimes(1);
    const opts = WebTracerProvider.mock.instances[0].opts;
    expect(opts.spanProcessors[0].exporter.headers.Authorization).toBe('Bearer abc');
    expect(opts.spanProcessors[0].exporter.url).toContain('/api/otel/v1/traces');
  });

  it('calls shutdown on existing provider if setup is called again', async () => {
    await clientBrowser.setup({ apiKey: 'abc', endpoint: 'https://foo', disableOpenTelemetryAutomaticSetup: false });
    const providerInstance = WebTracerProvider.mock.instances[0];
    await clientBrowser.setup({ apiKey: 'def', endpoint: 'https://bar', disableOpenTelemetryAutomaticSetup: false });
    expect(providerInstance.shutdown).toHaveBeenCalled();
  });

  it('does not set up WebTracerProvider if disableOpenTelemetryAutomaticSetup is true', async () => {
    await clientBrowser.setup({ apiKey: 'abc', endpoint: 'https://foo', disableOpenTelemetryAutomaticSetup: true });
    expect(WebTracerProvider).not.toHaveBeenCalled();
  });
});
