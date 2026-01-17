export {
  applySpanProtections,
  applyTraceProtections,
  extractRedactionsForObject,
  redactObject,
} from "./redaction";
export {
  mapNormalizedSpansToSpans,
  mapNormalizedSpanToSpan,
} from "./span.mapper";
export {
  mapAttributesToMetadata,
  mapTraceSummaryToTrace,
} from "./trace-summary.mapper";
