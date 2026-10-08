import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { instantEvalRestCredential } from "@langwatch/instant-eval-contract";
import { defineProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { InstantEvalModule } from "./app/instant-eval.app.ts";
import { instantEvalChannels } from "./channels/instant-eval-channels.registry.ts";
import { instantEvalEventing } from "./eventing/instant-eval-processing.pipeline.ts";
import { instantEvalRepositories } from "./repositories/instant-eval-repositories.registry.ts";
import { InstantEvalJudgeSpendBackfillService } from "./services/instant-eval-judge-spend-backfill.service.ts";
import { InstantEvalJudgeSpendCatchUpTask } from "./tasks/instant-eval-judge-spend-catch-up.task.ts";
import { instantEvalRest } from "./transport/instant-eval.rest.ts";
import { instantEvalTrpcTransport } from "./transport/instant-eval.trpc.ts";

export const instantEvalProcessModule = defineProcessModule("instant-eval")
  .withRepositories(instantEvalRepositories)
  .withChannels(instantEvalChannels)
  .withApi(InstantEvalModule)
  .withTransports(instantEvalRest, instantEvalTrpcTransport)
  // Every route of the family runs the statement as the KEY's own cut of the
  // project's content, so the door resolves the credential once and the
  // handlers never reach for it.
  .withTransportFacts(() => [
    bindRestMiddleware(instantEvalRestCredential, (context) =>
      credentialPrincipalOfToken(projectCredentialOfRequest(context.req.raw)),
    ),
  ])
  .withEventing(instantEvalEventing)
  // Background, after old writers are gone, after billing's usage-billing catch-up.
  .withMigrations(({ app, dependencies }) => [
    defineMigrationStep({
      id: "instant-eval:copy-judge-spend",
      kind: "data",
      mode: "background",
      description:
        "Copies each organisation's confirmed Instant Evals ledger spend into the judge's own spend, once per request.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterOrganizationId;
        const backfill = InstantEvalJudgeSpendBackfillService.create({
          peers: {
            organizations: dependencies.organizations,
            copy: (input) => app.copyLedgerSpendToJudge(input),
          },
        });
        const report = await backfill.backfill({
          after: typeof resumed === "string" ? resumed : undefined,
          dryRun,
          signal,
          onPage: (page) => checkpoint.save({ report: page }),
        });
        return { ...report, dryRun };
      },
    }),
  ])
  .withTasks(({ app, dependencies }) => [
    InstantEvalJudgeSpendCatchUpTask.create({
      organizations: dependencies.organizations,
      instantEvals: app,
    }),
  ]);
