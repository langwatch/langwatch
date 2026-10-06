import { defineProcessModule } from "@langwatch/process";

import { AutomationModule } from "./app/automation.app.ts";
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
