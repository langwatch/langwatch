/**
 * The process's OTLP span lane: batched export to the collector, built on the
 * same authoritative configuration the metrics lane uses so neither picks up a
 * stale value from the OTel SDK's own ambient environment reading.
 */
import {
  getSharedConfigurationDefaults,
  OTLPExporterBase,
} from "@opentelemetry/otlp-exporter-base";
import {
  createOtlpHttpExportDelegate,
  httpAgentFactoryFromOptions,
} from "@opentelemetry/otlp-exporter-base/node-http";
import {
  ProtobufTraceSerializer,
  TraceExporterMetricsHelper,
} from "@opentelemetry/otlp-transformer-telemetry";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type ReadableSpan,
  type Sampler,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { createAuthoritativeOtlpConfiguration } from "./otlp-configuration.ts";

export type OtlpTraceExportOptions = Readonly<{
  endpoint: string | undefined;
  headers: Readonly<Record<string, string>>;
}>;

/**
 * The span processors this process exports with — empty when no collector is
 * configured, which is what leaves local development recording but not exporting.
 */
export function otlpSpanProcessors({ endpoint, headers }: OtlpTraceExportOptions): SpanProcessor[] {
  if (!endpoint) return [];

  const exporter: SpanExporter = new OTLPExporterBase<ReadableSpan[]>(
    createOtlpHttpExportDelegate(
      createAuthoritativeOtlpConfiguration({
        url: `${endpoint}/v1/traces`,
        headers,
        contentType: "application/x-protobuf",
        getDefaults: getSharedConfigurationDefaults,
        agentFactoryFromOptions: httpAgentFactoryFromOptions,
      }),
      ProtobufTraceSerializer,
      "otlp_http_span_exporter",
      TraceExporterMetricsHelper,
      void 0,
    ),
  );

  return [new BatchSpanProcessor(exporter)];
}

/**
 * Parent-based, so a ratio keeps a whole trace or none of it. A per-span ratio
 * would shred traces into disconnected fragments.
 */
export function tracesSampler(ratio: number | undefined): Sampler | undefined {
  if (ratio === undefined) return void 0;

  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
}
