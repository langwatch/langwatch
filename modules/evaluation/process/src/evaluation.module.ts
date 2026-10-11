import type { EvaluationApi, EvaluationServerConfig } from "@langwatch/evaluation-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { EvaluationModule } from "./app/evaluation.app.ts";
import { evaluationChannels } from "./channels/evaluation-channels.registry.ts";
import { evaluationLifecycleEventing } from "./eventing/evaluation-lifecycle.pipeline.ts";
import { evaluationProcessingEventing } from "./eventing/evaluation-processing.pipeline.ts";
import { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";
import { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
import { evaluationsLegacyRest } from "./transport/evaluations-legacy.rest.ts";

export const evaluationProcessModule: PublishedProcessModule<
  "evaluation",
  EvaluationApi,
  EvaluationServerConfig
> = defineProcessModule("evaluation")
  .withRepositories(evaluationRepositories)
  .withChannels(evaluationChannels)
  .withApi(EvaluationModule)
  .withTransports(evaluationTrpcTransport, evaluationsLegacyRest)
  .withEventing(evaluationProcessingEventing)
  .withEventing(evaluationLifecycleEventing)
  .withMigrations(({ app }) => [
    defineMigrationStep({
      id: "evaluation:fill-id-indexes",
      kind: "data",
      mode: "background",
      description:
        "Fills the evaluation run id index from rows older than its view, then turns the lookup on per ClickHouse target.",
      // Old releases fire the same server-side view, so nothing waits for them to leave.
      needsOldWritersGone: false,
      // Level-triggered: min/max merge, so a rerun changes no range and resumes at its cursor.
      run: ({ checkpoint, dryRun, signal }) => app.fillIdIndexes({ checkpoint, dryRun, signal }),
    }),
  ]);
