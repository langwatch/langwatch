import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AutomationClock } from "../../app/automation.infrastructure.ts";
import type { AutomationRepositories } from "../automation.repositories.ts";

/** The client the automation rows live in, as a process hands it over. */
export type AutomationDatabase = PrismaClient;
import { PrismaCustomGraphRepository } from "./prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionNameRepository } from "./prisma.email-suppression-name.repository.ts";
import { PrismaEmailSuppressionRepository } from "./prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "./prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerFireHistoryRepository } from "./prisma.trigger-fire-history.repository.ts";
import { PrismaTriggerRepository } from "./prisma.trigger.repository.ts";
import { PrismaWebhookDeliveryRepository } from "./prisma.webhook-delivery.repository.ts";

/**
 * The "postgres" tier. Every automation row lives in one database, and the
 * trigger row stamps `lastRunAt` from the process's clock, so the clock is a
 * required input of the tier beside the client.
 */
export class PostgresAutomationRepositories {
  static readonly requires = ["prisma", "clock"] as const;

  static create(
    infrastructure: Readonly<{ prisma: PrismaClient; clock: AutomationClock }>,
  ): AutomationRepositories {
    const database = infrastructure.prisma;

    return {
      triggers: PrismaTriggerRepository.create(database, infrastructure.clock),
      history: PrismaTriggerFireHistoryRepository.create(database),
      suppressions: PrismaEmailSuppressionRepository.create(database),
      names: PrismaEmailSuppressionNameRepository.create(database),
      customGraphs: PrismaCustomGraphRepository.create(database),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(database),
      graphTriggerSent: PrismaGraphTriggerSentRepository.create(database),
    };
  }
}
