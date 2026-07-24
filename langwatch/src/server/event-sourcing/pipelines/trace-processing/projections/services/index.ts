// Only export what the orchestrator (traceSummary.foldProjection.ts) needs.
// Tests should import directly from the specific service file.
export { SpanTimingService } from "./span-timing.service";
export { SpanStatusService } from "./span-status.service";
export { TraceOriginService } from "./trace-origin.service";
export { SpanCostService, NON_BILLABLE_ATTR } from "./span-cost.service";
export { TraceAttributeAccumulationService } from "./trace-attribute-accumulation.service";
export {
  TraceIOAccumulationService,
  shouldOverrideOutput,
  extractIOFromLogRecord,
  OUTPUT_SOURCE,
} from "./trace-io-accumulation.service";
export { liftCanonicalAttributesFromLogRecord } from "./log-extractor-driver";
export { TracePromptAccumulationService } from "./trace-prompt-accumulation.service";
export { TraceNameResolutionService } from "./trace-name-resolution.service";
