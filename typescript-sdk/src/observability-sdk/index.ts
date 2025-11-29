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
} from "./features/data-capture";

export {
  createLangWatchSpan,
  type LangWatchSpan,
  type SpanType,
  spanTypes,
  type LangWatchSpanMetrics,
  type LangWatchSpanRAGContext,
  type LangWatchSpanOptions,
  type InputOutputType,
  type JsonSerializable,
  type SimpleChatMessage,
  type INPUT_OUTPUT_TYPES,
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

export {
  AISDKSpanProcessor,
  isAISDKSpan,
  getAISDKSpanType,
} from "./instrumentation/vercel-ai-sdk";

export { LangWatchCallbackHandler } from "./instrumentation/langchain";
