import { defineProcessModule } from "@langwatch/process";
import { defineMigrationStep, type MigrationStepRun } from "@langwatch/upgrade/step";

import { AutomationModule } from "./app/automation.app.ts";
import { automationChannels } from "./channels/automation-channels.registry.ts";
import { automationsEventing } from "./eventing/automations.pipeline.ts";
import { automationRepositories } from "./repositories/automation-repositories.registry.ts";
import type { AutomationTraceTriggerCatalogueRepository } from "./repositories/automation-trace-trigger-catalogue.repository.ts";
import type { AutomationClock } from "./repositories/automation.repositories.ts";
import type { CustomGraphRepository } from "./repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "./repositories/graph-trigger-sent.repository.ts";
import {
  PrismaCustomGraphRepository,
  type CustomGraphDatabase,
} from "./repositories/prisma/prisma.custom-graph.repository.ts";
import {
  PrismaGraphTriggerSentRepository,
  type GraphTriggerSentDatabase,
} from "./repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "./repositories/prisma/prisma.trigger.repository.ts";
import type { TriggerRepository, TriggerSecretCipher } from "./repositories/trigger.repository.ts";
import { slackClaimReconcileCursorSchema } from "./services/automation-slack-claim-reconcile.service.ts";
import { AutomationTraceTriggerCatalogueService } from "./services/automation-trace-trigger-catalogue.service.ts";
import { ReportScheduleBackfillTask } from "./tasks/report-schedule-backfill.task.ts";
import { SlackAlertTask } from "./tasks/slack-alert.task.ts";
import { createAutomationRest } from "./transport/automation.rest.ts";
import { automationTrpcTransport } from "./transport/automation.trpc.ts";
import { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
import { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
import { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export const automationProcessModule = defineProcessModule("automation")
  .withRepositories(automationRepositories)
  .withChannels(automationChannels)
  .withApi(AutomationModule)
  .withTransports(
    createAutomationRest(),
    automationTrpcTransport,
    emailSuppressionTrpcTransport,
    slackAutomationRest,
    unsubscribeRest,
  )
  .withTasks(({ app, config }) => [
    SlackAlertTask.create({ baseHost: config.publicBaseUrl ?? "" }),
    ReportScheduleBackfillTask.create(app),
  ])
  .withMigrations(({ app }) => {
    const run: MigrationStepRun = async ({ dryRun }) =>
      dryRun ? { dryRun: true } : app.reconcileReportSchedules();
    const description =
      "Gives every active report automation its schedule; reports already scheduled or paused are left alone.";
    return [
      defineMigrationStep({
        id: "automation:reconcile-report-schedules",
        kind: "data",
        mode: "background",
        description,
        run,
      }),
      defineMigrationStep({
        id: "automation:reconcile-report-schedules-after-rollout",
        kind: "data",
        mode: "background",
        description: `${description} Runs again once older images stop serving.`,
        // An older image creates reports without a schedule process: run again once none serves.
        needsOldWritersGone: true,
        run,
      }),
      defineMigrationStep({
        id: "automation:reconcile-slack-claims",
        kind: "data",
        mode: "background",
        description:
          "Claims each active Slack automation's connection and releases claims no active automation holds.",
        // An older image saves Slack automations without claiming: run once none serves.
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = slackClaimReconcileCursorSchema.safeParse(checkpoint.resumeFrom);
          const counts = await app.reconcileSlackClaims({
            from: resumed.success ? resumed.data : undefined,
            dryRun,
            signal,
            onPage: ({ cursor }) =>
              dryRun ? Promise.resolve() : checkpoint.save({ report: cursor }),
          });
          return { ...counts, dryRun };
        },
      }),
    ];
  })
  .withEventing(automationsEventing);

/**
 * The durable automation rows a composing process writes through, each built here rather than by
 * naming the Prisma class: a process holds the client, the module holds the choice of what reads
 * and writes it (private-runtime-export drive, dev/docs/plans/private-runtime-export-drive.md §3d).
 */
export function createAutomationTriggers(
  database: TriggerDatabase,
  clock: AutomationClock,
  cipher: TriggerSecretCipher,
): TriggerRepository {
  return PrismaTriggerRepository.create(database, clock, cipher);
}

/** The trigger-sent ledger a graph alert reads before it fires twice. */
export function createAutomationGraphTriggerSent(
  database: GraphTriggerSentDatabase,
): GraphTriggerSentRepository {
  return PrismaGraphTriggerSentRepository.create(database);
}

/** The custom graphs a report schedule renders from. */
export function createAutomationCustomGraphs(database: CustomGraphDatabase): CustomGraphRepository {
  return PrismaCustomGraphRepository.create(database);
}

/** The trace triggers an ingested trace is matched against. */
export function createAutomationTraceTriggerCatalogue(input: {
  prisma: TriggerDatabase;
  clock: AutomationClock;
  cipher: TriggerSecretCipher;
}): AutomationTraceTriggerCatalogueRepository {
  return AutomationTraceTriggerCatalogueService.create({
    triggers: PrismaTriggerRepository.create(input.prisma, input.clock, input.cipher),
    clock: input.clock,
  });
}
