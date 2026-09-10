import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  AutomationClock,
  AutomationDispatchError,
  AutomationLogger,
  AutomationNotificationDelivery,
  AutomationProjectIdentityPort,
} from "../../app/automation.infrastructure.ts";
import { PrismaCustomGraphRepository } from "./prisma.custom-graph.repository.ts";
import { PrismaGraphTriggerSentRepository } from "./prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerRepository } from "./prisma.trigger.repository.ts";
import type { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { AutomationGraphActivityService } from "../../services/automation-graph-activity.service.ts";
import { PrismaAutomationGraphDeliveryRepository } from "./prisma.automation-graph-delivery.repository.ts";
import { AutomationSlackSecretsService, AutomationSlackBotTokenDecryptorService, type AutomationSecretCrypto } from "../../services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../../services/automation-webhook-secrets.service.ts";

/**
 * The tables this vertical reads and writes, and no others.
 *
 * Derived from the client rather than restated, so it cannot drift from the
 * schema; narrowed rather than passed whole, so a composition root can hand
 * its one typed client down WITHOUT naming generated Prisma itself. That is
 * the containment rule working: `PrismaClient` is named here, in the Postgres
 * adapter, and nowhere above it.
 */
export type AutomationGraphActivityDatabase = Pick<
  PrismaClient,
  | "trigger"
  | "customGraph"
  | "triggerSent"
  | "emailSuppression"
  | "webhookEndpointDelivery"
  | "project"
  | "$queryRaw"
  | "$executeRaw"
>;

/** Process-composition shim for the graph-alert vertical. */
export class PrismaAutomationGraphActivityRepository {
  static create(input: {
    /** The one database client the composing process opened. */
    prisma: AutomationGraphActivityDatabase;
    clock: AutomationClock;
    projects: AutomationProjectIdentityPort;
    analytics: AnalyticsService;
    /** The process's outbound transports: mail, Slack, webhook. */
    delivery: AutomationNotificationDelivery;
    /** Reads the Slack bot tokens and webhook secrets this deployment wrote. */
    crypto: AutomationSecretCrypto;
    emailCaps: AutomationEmailCapService;
    logger: AutomationLogger;
    /** How the process's queue tells a permanent failure from a retryable one. */
    dispatchErrors: AutomationDispatchError;
    /** The deployment's own origin; every link in an alert is built from it. */
    baseHost: string;
    emailHourlyCap: number;
    tenantDailyCap: number;
  }): AutomationGraphActivityService {
    const triggers = PrismaTriggerRepository.create(input.prisma, input.clock);
    const persistence = PrismaAutomationGraphDeliveryRepository.create({
      database: input.prisma,
      clock: input.clock,
    });

    return AutomationGraphActivityService.create({
      triggers,
      customGraphs: PrismaCustomGraphRepository.create(input.prisma),
      graphTriggerSent: PrismaGraphTriggerSentRepository.create(input.prisma),
      persistence,
      clock: input.clock,
      projects: input.projects,
      analytics: input.analytics,
      delivery: input.delivery,
      webhooks: AutomationWebhookSecretsService.create(input.crypto),
      slackTokens: new AutomationSlackBotTokenDecryptorService(AutomationSlackSecretsService.create(input.crypto)),
      emailCaps: input.emailCaps,
      logger: input.logger,
      dispatchErrors: input.dispatchErrors,
      baseHost: input.baseHost,
      emailHourlyCap: input.emailHourlyCap,
      tenantDailyCap: input.tenantDailyCap,
    });
  }
}
