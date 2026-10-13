/**
 * The daily sweep of the studio's quiet NLP Lambda functions: a scheduled
 * process with no events of its own, replacing main's `/api/cron/old_lambdas_cleanup`.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { WorkflowModule } from "../app/workflow.app.ts";
import type { WorkflowRepositories } from "../repositories/workflow-repositories.registry.ts";
import {
  NLP_LAMBDA_CLEANUP_INTERVAL_MS,
  NLP_LAMBDA_CLEANUP_PROCESS_NAME,
  nlpLambdaCleanupStateSchema,
  nlpLambdaCleanupSweepSchema,
  nlpLambdaCleanupWake,
  runNlpLambdaCleanup,
  type NlpLambdaCleanupRunDeps,
} from "./workflow-nlp-lambda-cleanup.process.ts";

export const NLP_LAMBDA_CLEANUP_PIPELINE_NAME = "workflow_nlp_lambda_cleanup";

export function buildNlpLambdaCleanupPipeline(
  deps: Omit<NlpLambdaCleanupRunDeps, "now">,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: NLP_LAMBDA_CLEANUP_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(NLP_LAMBDA_CLEANUP_PROCESS_NAME, (pm) =>
      pm
        .state(nlpLambdaCleanupStateSchema, { lastSweepAt: null })
        .schedule({ everyMs: NLP_LAMBDA_CLEANUP_INTERVAL_MS })
        .onWake(nlpLambdaCleanupWake)
        .intent(
          "sweep",
          nlpLambdaCleanupSweepSchema,
          runNlpLambdaCleanup({ ...deps, now: () => nowInstant().epochMilliseconds }),
        )
        // A failed sweep dead-letters for an operator; the next day's wake asks for a fresh one.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 }),
    )
    .build();
}

export const workflowNlpLambdaCleanupEventing = defineEventingModule({
  pipeline: NLP_LAMBDA_CLEANUP_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<WorkflowRepositories, WorkflowModule>) =>
    app.nlpLambdaCleanupPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});
