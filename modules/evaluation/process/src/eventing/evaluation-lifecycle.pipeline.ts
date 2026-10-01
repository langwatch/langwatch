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
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { EvaluationApp } from "../app/evaluation.app.ts";
import {
  RecordEvaluationLifecycleCompletedCommand,
  RecordEvaluationRanCommand,
} from "./evaluation-lifecycle.commands.ts";
import {
  evaluationLifecycleCompletedEventSchema,
  evaluationRanEventSchema,
  type EvaluationLifecycleEvent,
  type RecordEvaluationLifecycleCompletedCommandData,
  type RecordEvaluationRanCommandData,
} from "./evaluation-lifecycle.events.ts";

export type EvaluationLifecyclePipeline = StaticPipelineDefinition<
  EvaluationLifecycleEvent,
  Record<string, Projection>,
  | { name: "recordEvaluationRan"; payload: RecordEvaluationRanCommandData }
  | {
      name: "recordEvaluationLifecycleCompleted";
      payload: RecordEvaluationLifecycleCompletedCommandData;
    }
>;

/** evaluation_lifecycle: evaluation records its facts; peers react from their own side (§9). */
export function buildEvaluationLifecyclePipeline(): EvaluationLifecyclePipeline {
  return definePipeline({
    name: EVALUATION_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: EVALUATION_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([evaluationRanEventSchema, evaluationLifecycleCompletedEventSchema])
    .withCommand("recordEvaluationRan", RecordEvaluationRanCommand)
    .withCommand("recordEvaluationLifecycleCompleted", RecordEvaluationLifecycleCompletedCommand)
    .build();
}

export const evaluationLifecycleEventing = defineEventingModule({
  pipeline: EVALUATION_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, EvaluationApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
