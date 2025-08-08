export {
  FilterableBatchSpanProcessor,
  type SpanProcessingExcludeRule,
} from "./processors";
export {
  LangWatchExporter,
  type LangWatchExporterOptions,
  LangWatchTraceExporter,
  type LangWatchTraceExporterOptions,
  LangWatchLogsExporter,
  type LangWatchLogsExporterOptions,
} from "./exporters";

export {
  type DataCaptureConfig,
  type DataCaptureMode,
  type DataCaptureContext,
  type DataCapturePredicate,
  type DataCaptureOptions,
  DataCapturePresets,
  createEnvironmentAwareConfig,
} from "./features/data-capture";

export {
  createLangWatchSpan,
  type LangWatchSpan,
  type SpanType,
  spanTypes,
} from "./span";

export {
  getLangWatchLogger,
  getLangWatchLoggerFromProvider,
  type LangWatchLogger,
} from "./logger";
export {
  getLangWatchTracer,
  getLangWatchTracerFromProvider,
  type LangWatchTracer,
} from "./tracer";

export {
  getDataCaptureMode,
  shouldCaptureInput,
  shouldCaptureOutput,
} from "./config.js";

export {
  type SemConvAttributes,
  type SemConvLogRecordAttributes,
  type SemConvAttributeKey,
} from "./semconv";

export * as attributes from "./semconv/attributes";
