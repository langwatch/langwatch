/** Node-only process composition for the shared logging and tracing spine. */

export {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityFlusher,
  type ProcessObservabilityOptions,
} from "./process-observability.ts";

export { createAuthoritativeOtlpConfiguration } from "./otlp-configuration.ts";
export { UnexportedSpanProcessor } from "./unexported-spans.ts";
export {
  normaliseTagKey,
  startProfiling,
  tagsFromResourceAttributes,
  type ProfilingOptions,
  type StartedProfiler,
} from "./profiling.ts";
export {
  otlpMetricsExportOptionsFrom,
  startOtlpMetricsExport,
  type OtlpMetricsExportOptions,
  type OtlpMetricsTelemetryInputs,
} from "./otlp-metrics.ts";
export {
  prometheusMetrics,
  type PrometheusExposition,
  type PrometheusMetricsOptions,
} from "./prometheus-metrics-door.ts";

// Every method of a service, wrapped in a span named `ClassName.methodName`,
// applied once at factory time so the service's own methods stay clean.
// Lives on the NODE entry, not the package root: it evaluates OpenTelemetry
// at import, and the root is asserted to load in a browser bundle without it.
export { traced } from "../trace/traced.ts";
