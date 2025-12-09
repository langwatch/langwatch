import { eventSourcing } from "../../runtime";
import { TriggerTraceAggregationCommand } from "./commands/triggerTraceAggregationCommand";
import { TraceSummaryStateProjectionHandler } from "./projections";
import type { TraceSummary } from "./projections/traceSummaryStateProjection";
import type { TraceAggregationEvent } from "./schemas/events";

export const traceAggregationPipeline = eventSourcing
  .registerPipeline<TraceAggregationEvent, TraceSummary>()
  .withName("trace_aggregation")
  .withAggregateType("trace_aggregation")
  .withProjection("traceSummary", TraceSummaryStateProjectionHandler)
  .withCommand("triggerTraceAggregation", TriggerTraceAggregationCommand)
  .build();
