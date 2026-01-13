export {
  mapNormalizedSpanToSpan,
  mapNormalizedSpansToSpans,
} from "./span.mapper";

export {
  mapTraceSummaryToTrace,
  mapAttributesToMetadata,
} from "./trace-summary.mapper";

export {
  applyTraceProtections,
  applySpanProtections,
  extractRedactionsForObject,
  redactObject,
} from "./redaction";
