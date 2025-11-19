import { eventSourcing } from "../../runtime";
import { TriggerTraceAggregationCommand } from "./commands/triggerTraceAggregationCommand";
import { traceAggregationStateProjectionRepository } from "./repositories";
import { TraceAggregationStateProjectionHandler } from "./projections";
import type { TraceAggregationStateProjection } from "./projections/traceAggregationStateProjection";
import type { TraceAggregationEvent } from "../../schemas";

export const traceAggregationPipeline = eventSourcing
  .registerPipeline<TraceAggregationEvent, TraceAggregationStateProjection>()
  .withName("trace-aggregation")
  .withAggregateType("trace_aggregation")
  .withProjection(
    "state",
    traceAggregationStateProjectionRepository,
    new TraceAggregationStateProjectionHandler(),
  )
  .withCommandHandler(TriggerTraceAggregationCommand)
  .build();
