import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as clientNode from '../client-node';
import * as client from '../client';

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts;
    this.start = vi.fn();
    this.shutdown = vi.fn();
  })
}));
vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: vi.fn().mockImplementation((exporter) => ({ exporter }))
}));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn().mockImplementation((opts) => opts)
}));

describe('client-node setup', () => {
  let NodeSDK: any;
  let BatchSpanProcessor: any;
  let OTLPTraceExporter: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    client.setConfig({ apiKey: undefined, endpoint: undefined });

    const sdkNode = await vi.importMock<any>('@opentelemetry/sdk-node');
    NodeSDK = sdkNode.NodeSDK;
    const sdkTraceBase = await vi.importMock<any>('@opentelemetry/sdk-trace-base');
    BatchSpanProcessor = sdkTraceBase.BatchSpanProcessor;
    const otlpExporter = await vi.importMock<any>('@opentelemetry/exporter-trace-otlp-http');
    OTLPTraceExporter = otlpExporter.OTLPTraceExporter;
  });

  it('calls setConfig and sets up NodeSDK with correct options', async () => {
    await clientNode.setup({ apiKey: 'abc', endpoint: 'https://foo', disableOpenTelemetryAutomaticSetup: false });
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    const opts = NodeSDK.mock.instances[0].opts;
    expect(opts.spanProcessors[0].exporter.headers.Authorization).toBe('Bearer abc');
    expect(opts.spanProcessors[0].exporter.url).toContain('/api/otel/v1/traces');
  });

  it('calls shutdown on existing sdk if setup is called again', async () => {
    await clientNode.setup({ apiKey: 'abc', endpoint: 'https://foo', disableOpenTelemetryAutomaticSetup: false });
    const sdkInstance = NodeSDK.mock.instances[0];
    await clientNode.setup({ apiKey: 'def', endpoint: 'https://bar', disableOpenTelemetryAutomaticSetup: false });
    expect(sdkInstance.shutdown).toHaveBeenCalled();
  });

  it('does not set up NodeSDK if disableOpenTelemetryAutomaticSetup is true', async () => {
    await clientNode.setup({ apiKey: 'abc', endpoint: 'https://foo', disableOpenTelemetryAutomaticSetup: true });
    expect(NodeSDK).not.toHaveBeenCalled();
  });
});
