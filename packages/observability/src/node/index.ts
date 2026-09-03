/** Node-only process composition for the shared logging and tracing spine. */

export {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityFlusher,
  type ProcessObservabilityOptions,
} from "./process-observability";

export { createAuthoritativeOtlpConfiguration } from "./otlp-configuration";
export { UnexportedSpanProcessor } from "./unexported-spans";
export {
  normaliseTagKey,
  startProfiling,
  tagsFromResourceAttributes,
  type ProfilingOptions,
  type StartedProfiler,
} from "./profiling";
export {
  otlpMetricsExportOptionsFrom,
  startOtlpMetricsExport,
  type OtlpMetricsExportOptions,
  type OtlpMetricsTelemetryInputs,
} from "./otlp-metrics";

// Every method of a service, wrapped in a span named `ClassName.methodName`.
// Applied once at factory time, so the service's own methods stay clean.
//
// On the NODE entry rather than the package root: it evaluates OpenTelemetry at
// import, and the root is asserted to load in a browser bundle without doing
// that.
export { traced } from "../trace/traced";
