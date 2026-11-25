import { projectRequestContextOf } from "@langwatch/api/rest";
import type { EvaluatorApi, EvaluatorServerConfig } from "@langwatch/evaluator-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { EvaluatorModule } from "./app/evaluator.app.ts";
import { evaluatorLifecycleEventing } from "./eventing/evaluator-lifecycle.pipeline.ts";
import { evaluatorWorkflowArchiveCascadeEventing } from "./eventing/evaluator-workflow-archive-cascade.pipeline.ts";
import { evaluatorRepositories } from "./repositories/evaluator-repositories.registry.ts";
import { EvaluatorVersionService } from "./services/evaluator-version.service.ts";
import { createEvaluatorRest } from "./transport/evaluator.rest.ts";
import { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";

export const evaluatorProcessModule: PublishedProcessModule<
  "evaluator",
  EvaluatorApi,
  EvaluatorServerConfig
> = defineProcessModule("evaluator")
  .withRepositories(evaluatorRepositories)
  .withApi(EvaluatorModule)
  .withTransports(createEvaluatorRest(), evaluatorTrpcTransport)
  .provideMiddlewareContext({ projectRequestContext: projectRequestContextOf })
  .withEventing(evaluatorLifecycleEventing)
  .withEventing(evaluatorWorkflowArchiveCascadeEventing)
  .withMigrations(({ dependencies, repositories }) => [
    defineMigrationStep({
      id: "evaluator:backfill-versions",
      kind: "data",
      mode: "background",
      description:
        "Records version 1 of every evaluator written before versions existed, with its creator from the audit log.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterId;
        return EvaluatorVersionService.create({
          repository: repositories.evaluators,
          users: dependencies.users,
          permissions: dependencies.permissions,
          auditLog: dependencies.auditLog,
        }).backfill({
          dryRun,
          signal,
          afterId: typeof resumed === "string" ? resumed : null,
          onPage: (report) => checkpoint.save({ report }),
        });
      },
    }),
  ]);
