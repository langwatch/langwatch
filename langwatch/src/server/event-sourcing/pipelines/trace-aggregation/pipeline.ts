import { eventSourcing } from "../../runtime";
import { TriggerTraceAggregationCommand } from "./commands/triggerTraceAggregationCommand";
import type { TraceAggregationEvent } from "../../types/events/traceAggregation";
import { traceAggregationStateProjectionRepository } from "./repositories";
import { TraceAggregationStateProjectionHandler } from "./projections";
import type { TraceAggregationStateProjection } from "./projections/traceAggregationStateProjection";

import { exec } from "node:child_process";

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
  .withEventHandler("fuck-with-lights", {
    getEventTypes: () => ["lw.obs.trace_aggregation.completed"],
    handle: async () => {
      return new Promise((resolve, reject) => {
        exec("shortcuts run EventDrivenHome", (error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    },
  })
  .build();
