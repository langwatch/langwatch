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
  PrismaTriggerLatestEvaluationRepository,
  type TriggerLatestEvaluationDatabase,
} from "../repositories/prisma/prisma.trigger-latest-evaluation.repository.ts";
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
import type { AutomationSecretCrypto } from "../services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../services/automation-webhook-secrets.service.ts";
import type { AutomationEmailCapService } from "../services/email-cap.service.ts";
import type { SlackDestinationService } from "../services/slack-destination.service.ts";
import { TriggerLatestEvaluationService } from "../services/trigger-latest-evaluation.service.ts";
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
  WebhookDeliveryDatabase &
  TriggerLatestEvaluationDatabase;

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
  /** Where every Slack delivery goes, over `SlackApi` (ARCHITECTURE.md §3). */
  slackDestinations: SlackDestinationService;
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
    slackDestinations: input.slackDestinations,
    emailCaps: input.emailCaps,
    logger: input.logger,
    dispatchErrors: input.dispatchErrors,
    latestEvaluations: TriggerLatestEvaluationService.create({
      repository: PrismaTriggerLatestEvaluationRepository.create(input.prisma),
      logger: input.logger,
    }),
    baseHost: input.baseHost,
    emailHourlyCap: input.emailHourlyCap,
    tenantDailyCap: input.tenantDailyCap,
  });
}
