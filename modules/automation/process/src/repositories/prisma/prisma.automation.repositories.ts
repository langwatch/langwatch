import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";
import type { AutomationClock } from "../../app/automation.members.ts";
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
 * The live tier. Every automation row lives in one database; the Instant
 * clock trigger rows stamp `lastRunAt` from needs no process information,
 * so the tier builds its own rather than demanding a member.
 */
export class PostgresAutomationRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): AutomationRepositories {
    const database = members.prisma;
    const clock: AutomationClock = { now: () => nowInstant() };

    return {
      triggers: PrismaTriggerRepository.create(database, clock),
      history: PrismaTriggerFireHistoryRepository.create(database),
      suppressions: PrismaEmailSuppressionRepository.create(database),
      names: PrismaEmailSuppressionNameRepository.create(database),
      customGraphs: PrismaCustomGraphRepository.create(database),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(database),
      graphTriggerSent: PrismaGraphTriggerSentRepository.create(database),
    };
  }
}
