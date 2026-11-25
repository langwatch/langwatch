import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/evaluation-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type RetentionPolicyResolver,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { EvaluationModule } from "../app/evaluation.app.ts";
import {
  RecordEvaluationLifecycleCompletedCommand,
  RecordEvaluationRanCommand,
  RecordMonitorErrorRateExceededCommand,
} from "./evaluation-lifecycle.commands.ts";
import {
  evaluationLifecycleCompletedEventSchema,
  evaluationMonitorErrorRateExceededEventSchema,
  evaluationRanEventSchema,
  type EvaluationLifecycleEvent,
  type RecordEvaluationLifecycleCompletedCommandData,
  type RecordEvaluationRanCommandData,
  type RecordMonitorErrorRateExceededCommandData,
} from "./evaluation-lifecycle.events.ts";

export type EvaluationLifecyclePipeline = StaticPipelineDefinition<
  EvaluationLifecycleEvent,
  Record<string, Projection>,
  | { name: "recordEvaluationRan"; payload: RecordEvaluationRanCommandData }
  | {
      name: "recordEvaluationLifecycleCompleted";
      payload: RecordEvaluationLifecycleCompletedCommandData;
    }
  | {
      name: "recordMonitorErrorRateExceeded";
      payload: RecordMonitorErrorRateExceededCommandData;
    }
>;

/** evaluation_lifecycle: evaluation records its facts; peers react from their own side (§9). */
export function buildEvaluationLifecyclePipeline(
  retention?: RetentionPolicyResolver,
): EvaluationLifecyclePipeline {
  const pipeline = definePipeline({
    name: EVALUATION_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: EVALUATION_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([
      evaluationRanEventSchema,
      evaluationLifecycleCompletedEventSchema,
      evaluationMonitorErrorRateExceededEventSchema,
    ])
    .withCommand("recordEvaluationRan", RecordEvaluationRanCommand)
    .withCommand("recordEvaluationLifecycleCompleted", RecordEvaluationLifecycleCompletedCommand)
    .withCommand("recordMonitorErrorRateExceeded", RecordMonitorErrorRateExceededCommand);
  return (retention === undefined ? pipeline : pipeline.withRetention(retention)).build();
}

export const evaluationLifecycleEventing = defineEventingModule({
  pipeline: EVALUATION_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, EvaluationModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
