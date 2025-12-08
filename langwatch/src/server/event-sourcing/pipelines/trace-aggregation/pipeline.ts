import { eventSourcing } from "../../runtime";
import { TriggerTraceAggregationCommand } from "./commands/triggerTraceAggregationCommand";
import { TraceAggregationStateProjectionHandler } from "./projections";
import type { TraceProjection } from "./projections/traceAggregationStateProjection";
import type { TraceAggregationEvent } from "./schemas/events";

export const traceAggregationPipeline = eventSourcing
  .registerPipeline<TraceAggregationEvent, TraceProjection>()
  .withName("trace_aggregation")
  .withAggregateType("trace_aggregation")
  .withProjection("traceOverview", TraceAggregationStateProjectionHandler)
  .withCommand("triggerTraceAggregation", TriggerTraceAggregationCommand)
  .build();
