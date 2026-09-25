import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  AutomationClock,
  AutomationDispatchError,
  AutomationLogger,
  AutomationNotificationDelivery,
  AutomationProjectDirectory,
} from "../../app/automation.members.ts";
import { AutomationGraphActivityService } from "../../services/automation-graph-activity.service.ts";
import {
  AutomationSlackSecretsService,
  AutomationSlackBotTokenDecryptorService,
  type AutomationSecretCrypto,
} from "../../services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../../services/automation-webhook-secrets.service.ts";
import type { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { PostgresAutomationGraphDeliveryAdapter } from "./prisma.automation-graph-delivery.repository.ts";
import { PrismaCustomGraphRepository } from "./prisma.custom-graph.repository.ts";
import { PrismaGraphTriggerSentRepository } from "./prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerRepository } from "./prisma.trigger.repository.ts";

// Restricted Pick of PrismaClient; containment rule — PrismaClient named only
// here and in the adapter.
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
export class PostgresAutomationGraphActivityAdapter {
  static create(input: {
    /** The one database client the composing process opened. */
    prisma: AutomationGraphActivityDatabase;
    clock: AutomationClock;
    projects: AutomationProjectDirectory;
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
    const persistence = PostgresAutomationGraphDeliveryAdapter.create({
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
      slackTokens: AutomationSlackBotTokenDecryptorService.create(
        AutomationSlackSecretsService.create(input.crypto),
      ),
      emailCaps: input.emailCaps,
      logger: input.logger,
      dispatchErrors: input.dispatchErrors,
      baseHost: input.baseHost,
      emailHourlyCap: input.emailHourlyCap,
      tenantDailyCap: input.tenantDailyCap,
    });
  }
}
