// Only export what the orchestrator (traceSummary.foldProjection.ts) needs.
// Tests should import directly from the specific service file.

export { liftCanonicalAttributesFromLogRecord } from "./log-extractor-driver";
export {
  NON_BILLABLE_ATTR,
  SpanCostService,
  sumStepContext,
} from "./span-cost.service";
export { SpanStatusService } from "./span-status.service";
export { SpanTimingService } from "./span-timing.service";
export { TraceAttributeAccumulationService } from "./trace-attribute-accumulation.service";
export {
  extractIOFromLogRecord,
  OUTPUT_SOURCE,
  shouldOverrideOutput,
  TraceIOAccumulationService,
} from "./trace-io-accumulation.service";
export { TraceNameResolutionService } from "./trace-name-resolution.service";
export { TraceOriginService } from "./trace-origin.service";
export { TracePromptAccumulationService } from "./trace-prompt-accumulation.service";
