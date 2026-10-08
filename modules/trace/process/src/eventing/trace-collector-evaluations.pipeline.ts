import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { TraceModule } from "../app/trace.app.ts";
import { RecordCollectorEvaluationCommand } from "./trace-collector-evaluations.commands.ts";
import {
  collectorEvaluationReceivedEventSchema,
  TRACE_COLLECTOR_EVALUATION_AGGREGATE_TYPE,
  TRACE_COLLECTOR_EVALUATIONS_PIPELINE_NAME,
} from "./trace-collector-evaluations.events.ts";

function collectorEvaluationCommands() {
  return definePipeline({
    name: TRACE_COLLECTOR_EVALUATIONS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: TRACE_COLLECTOR_EVALUATION_AGGREGATE_TYPE }),
  })
    .withEvents([collectorEvaluationReceivedEventSchema])
    .withCommand("recordCollectorEvaluation", RecordCollectorEvaluationCommand);
}

export type TraceCollectorEvaluationsDefinition = ReturnType<
  ReturnType<typeof collectorEvaluationCommands>["build"]
>;

/** trace_collector_evaluations records; evaluation reports each from its side (§9, T1 D1). */
export function buildTraceCollectorEvaluationsPipeline(): TraceCollectorEvaluationsDefinition {
  return collectorEvaluationCommands().build();
}

export const traceCollectorEvaluationsEventing = defineEventingModule({
  pipeline: TRACE_COLLECTOR_EVALUATIONS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, TraceModule>) => app.collectorEvaluationsPipeline(),
  connect: ({ app, commands }) => app.connectCollectorEvaluations(commands),
});
