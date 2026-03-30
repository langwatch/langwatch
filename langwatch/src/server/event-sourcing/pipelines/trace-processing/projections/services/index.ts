// Only export what the orchestrator (traceSummary.foldProjection.ts) needs.
// Tests should import directly from the specific service file.
export { SpanTimingService } from "./span-timing.service";
export { SpanStatusService } from "./span-status.service";
export { TraceOriginService } from "./trace-origin.service";
export { SpanCostService } from "./span-cost.service";
export { TraceAttributeAccumulationService } from "./trace-attribute-accumulation.service";
export {
  TraceIOAccumulationService,
  shouldOverrideOutput,
  extractIOFromLogRecord,
  OUTPUT_SOURCE,
} from "./trace-io-accumulation.service";
export { ScenarioRoleCostService } from "./scenario-role-cost.service";
