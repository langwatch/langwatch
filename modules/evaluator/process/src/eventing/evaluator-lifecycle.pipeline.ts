import {
  EVALUATOR_AGGREGATE_TYPE,
  EVALUATOR_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/evaluator-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { EvaluatorModule } from "../app/evaluator.app.ts";
import type { EvaluatorRepositories } from "../repositories/evaluator.repositories.ts";
import { RecordEvaluatorDeletedCommand } from "./evaluator-lifecycle.commands.ts";
import { evaluatorDeletedEventSchema } from "./evaluator-lifecycle.events.ts";

/**
 * evaluator_lifecycle: evaluator records its deletion; monitor removes the monitors that ran
 * it from its own side (§9). Spec: modules/evaluator/specs/evaluator-deleted-fact.feature
 */
function buildEvaluatorLifecyclePipeline() {
  return definePipeline({
    name: EVALUATOR_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: EVALUATOR_AGGREGATE_TYPE }),
  })
    .withEvents([evaluatorDeletedEventSchema])
    .withCommand("recordEvaluatorDeleted", RecordEvaluatorDeletedCommand)
    .build();
}

export const evaluatorLifecycleEventing = defineEventingModule({
  pipeline: EVALUATOR_LIFECYCLE_PIPELINE_NAME,
  build: (_setup: EventingSetup<EvaluatorRepositories, EvaluatorModule>) =>
    buildEvaluatorLifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
