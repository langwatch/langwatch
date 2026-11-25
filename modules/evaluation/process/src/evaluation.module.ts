import type { EvaluationApi, EvaluationServerConfig } from "@langwatch/evaluation-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { EvaluationModule } from "./app/evaluation.app.ts";
import { evaluationChannels } from "./channels/evaluation-channels.registry.ts";
import { evaluationLifecycleEventing } from "./eventing/evaluation-lifecycle.pipeline.ts";
import { evaluationProcessingEventing } from "./eventing/evaluation-processing.pipeline.ts";
import {
  EVALUATION_ID_INDEXES,
  EVALUATION_SECOND_ID_INDEXES,
} from "./repositories/clickhouse/clickhouse.evaluation-id-indexes.database.ts";
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
  .withIdIndexes(EVALUATION_ID_INDEXES, {
    after: ["trace:fill-id-indexes"],
    description:
      "Fills the evaluation run id index from rows older than its view, then turns the lookup on per ClickHouse target.",
  })
  .withIdIndexes(EVALUATION_SECOND_ID_INDEXES, {
    step: "fill-second-id-indexes",
    after: ["evaluation:fill-id-indexes"],
    description:
      "Fills the second id index of evaluation runs (by trace id) from older rows, then marks it ready on each ClickHouse target.",
  });
