import type { AnalyticsService } from "@langwatch/analytics-contract";

import {
  PrismaCustomGraphRepository,
  type CustomGraphDatabase,
} from "../repositories/prisma/prisma.custom-graph.repository.ts";
import {
  PrismaEmailSuppressionRepository,
  type EmailSuppressionDatabase,
} from "../repositories/prisma/prisma.email-suppression.repository.ts";
import {
  PrismaGraphTriggerSentRepository,
  type GraphTriggerSentDatabase,
} from "../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "../repositories/prisma/prisma.trigger.repository.ts";
import {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "../repositories/prisma/prisma.webhook-delivery.repository.ts";
import { AutomationGraphActivityService } from "../services/automation-graph-activity.service.ts";
import { AutomationGraphDeliveryService } from "../services/automation-graph-delivery.service.ts";
import {
  AutomationSlackSecretsService,
  AutomationSlackBotTokenDecryptorService,
  type AutomationSecretCrypto,
} from "../services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../services/automation-webhook-secrets.service.ts";
import type { AutomationEmailCapService } from "../services/email-cap.service.ts";
import type {
  AutomationClock,
  AutomationDispatchError,
  AutomationLogger,
  AutomationNotificationDelivery,
  AutomationProjectDirectory,
} from "./automation.members.ts";

/** The database slice the graph-alert vertical's repositories read. */
export type AutomationGraphActivityDatabase = TriggerDatabase &
  CustomGraphDatabase &
  GraphTriggerSentDatabase &
  EmailSuppressionDatabase &
  WebhookDeliveryDatabase;

/** Graph delivery's Automation persistence, over its Prisma repositories. */
export function composeAutomationGraphDelivery(input: {
  database: TriggerDatabase & EmailSuppressionDatabase & WebhookDeliveryDatabase;
  clock: AutomationClock;
}): AutomationGraphDeliveryService {
  return AutomationGraphDeliveryService.create({
    triggers: PrismaTriggerRepository.create(input.database, input.clock),
    suppressions: PrismaEmailSuppressionRepository.create(input.database),
    webhookDeliveries: PrismaWebhookDeliveryRepository.create(input.database),
  });
}

/** The graph-alert vertical, over its Prisma repositories. */
export function composeAutomationGraphActivity(input: {
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
  const persistence = composeAutomationGraphDelivery({
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
