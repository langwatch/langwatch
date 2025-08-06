export { getLangWatchTracer, getLangWatchTracerFromProvider } from "./tracer";
export { createLangWatchSpan } from "./span";
export { FilterableBatchSpanProcessor, type SpanProcessingExcludeRule } from "./processors";
export { LangWatchExporter, type LangWatchExporterOptions } from "./exporters";
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
  getDataCaptureMode,
  shouldCaptureInput,
  shouldCaptureOutput,
} from "./config.js";

export { type Logger, type LogLevel, ConsoleLogger, NoOpLogger } from "../logger";

export * from "./types";
export * as attributes from "./semconv/attributes";
