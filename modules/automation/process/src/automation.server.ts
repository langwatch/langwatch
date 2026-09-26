import type { AnalyticsService } from "@langwatch/analytics-contract";
import { defineServerModule } from "@langwatch/kernel";

import {
  composeAutomationGraphActivity,
  type AutomationGraphActivityDatabase,
} from "./app/automation-graph-composition.build.ts";
import { AutomationApp } from "./app/automation.app.ts";
import type {
  AutomationClock,
  AutomationDispatchError,
  AutomationEvaluationQueryClassification,
  AutomationEvaluationTraceSummary,
  AutomationGraphActivity,
  AutomationLogger,
  AutomationProjectDirectory,
  AutomationTriggerMatchRecorder,
} from "./app/automation.members.ts";
import type { AutomationNotificationDelivery } from "./channels/automation-notification-delivery.channel.ts";
import { automationsEventing } from "./eventing/automations.pipeline.ts";
import type { AutomationEmailCapRepository } from "./repositories/automation-email-cap.repository.ts";
import { automationRepositories } from "./repositories/automation-repositories.registry.ts";
import type { AutomationTraceTriggerCatalogueRepository } from "./repositories/automation-trace-trigger-catalogue.repository.ts";
import type { CustomGraphRepository } from "./repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "./repositories/graph-trigger-sent.repository.ts";
import type { AutomationTraceTriggerCatalogueDatabase } from "./repositories/prisma/prisma.automation-trace-trigger-catalogue.repository.ts";
import { PrismaAutomationTraceTriggerCatalogueRepository } from "./repositories/prisma/prisma.automation-trace-trigger-catalogue.repository.ts";
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
import {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "./repositories/prisma/prisma.webhook-delivery.repository.ts";
import type { TriggerRepository } from "./repositories/trigger.repository.ts";
import type { WebhookDeliveryRepository } from "./repositories/webhook-delivery.repository.ts";
import { AutomationEvaluationSubscriberService } from "./services/automation-evaluation-subscriber.service.ts";
import { AutomationEvaluationTriggerFilterService } from "./services/automation-evaluation-trigger-filter.service.ts";
import { AutomationMatchRecordMetricsService } from "./services/automation-match-record-metrics.service.ts";
import { type AutomationSecretCrypto } from "./services/automation-slack-secrets.service.ts";
import { AutomationEmailCapService } from "./services/email-cap.service.ts";
import {
  TriggerNoReplyService,
  TriggerNoReplyWarning,
} from "./services/trigger-no-reply.service.ts";
import {
  UnsubscribeTokenService,
  type UnsubscribeTokenPayload,
} from "./services/unsubscribe-token.service.ts";
import { ReportScheduleBackfillTask } from "./tasks/report-schedule-backfill.task.ts";
import { SlackAlertTask } from "./tasks/slack-alert.task.ts";
import { createAutomationRest } from "./transport/automation.rest.ts";
import { automationTrpcTransport } from "./transport/automation.trpc.ts";
import { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
import { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
import { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export type { AutomationInfrastructure } from "./app/automation.app.ts";

export const automationServer = defineServerModule("automation")
  .withRepositories(automationRepositories)
  .withApp(AutomationApp)
  .withTransports(
    createAutomationRest(),
    automationTrpcTransport,
    emailSuppressionTrpcTransport,
    slackAutomationRest,
    unsubscribeRest,
  )
  .withTasks(({ app, members }) => [
    SlackAlertTask.create({ baseHost: members.publicBaseUrl ?? "" }),
    ReportScheduleBackfillTask.create(app),
  ])
  .withEventing(automationsEventing);

/**
 * The envelope a trigger's mail leaves in: who it appears to come from,
 * and the token that stops it. Both are HMACs over one secret, composed
 * together so signing them differently could honour an unissued link.
 */
export type AutomationMailEnvelope = Readonly<{
  /** The `To:` a trigger's mail is addressed to, with recipients in bcc. */
  noReplyAddressFor(input: { defaultFrom: string; triggerId: string }): string;
  /** The signed token the unsubscribe footer's link carries. */
  signUnsubscribeToken(payload: UnsubscribeTokenPayload): string;
}>;

export function createAutomationMailEnvelope(input: {
  /**
   * `NEXTAUTH_SECRET`, as the application spells it. Absent degrades
   * unguessability, never blocks.
   */
  secret: string | undefined;
  /** Told once, when the deployment named no secret and the tag is forgeable. */
  onUnguessableAddress?: (message: string) => void;
}): AutomationMailEnvelope {
  const tokens = UnsubscribeTokenService.create({ secret: input.secret });
  const warn = input.onUnguessableAddress;
  const addresses = TriggerNoReplyService.create({
    secret: input.secret,
    ...(warn ? { warnings: new ReportedNoReplyWarning(warn) } : {}),
  });

  return {
    noReplyAddressFor: (address) => addresses.addressFor(address),
    signUnsubscribeToken: (payload) => tokens.sign(payload),
  };
}

class ReportedNoReplyWarning extends TriggerNoReplyWarning {
  constructor(private readonly report: (message: string) => void) {
    super();
  }

  unguessabilityUnavailable(message: string): void {
    this.report(message);
  }
}

/**
 * The email ceilings both halves of this feature spend against. Composed
 * once per process, since two services counting the same budget separately
 * would let one fleet send double; a failing store degrades to the per-pod fallback.
 */
export function createAutomationEmailCaps(input: {
  store: AutomationEmailCapRepository;
  fallback: AutomationEmailCapRepository;
}): AutomationEmailCapService {
  return AutomationEmailCapService.create(input);
}

/**
 * The graph-alert vertical, over substrates the composing process owns:
 * which tables it reads, which secrets it decrypts and which schedule it
 * checks; the process supplies the client, clock, transports and ceilings.
 */
export function createAutomationGraphActivity(input: {
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
}): AutomationGraphActivity {
  return composeAutomationGraphActivity(input);
}

/**
 * What this feature does when an evaluation finishes: decide whether the
 * run matched a trigger, and re-check the graph alerts it feeds. The
 * filter is built here, not handed in, so a caller can't reclassify a query.
 */
export function createAutomationEvaluationSubscriber(input: {
  triggers: AutomationTraceTriggerCatalogueRepository;
  graphActivity: AutomationGraphActivity;
  /** The trace summary a match is confirmed against, and how its query is read. */
  traces: AutomationEvaluationTraceSummary & AutomationEvaluationQueryClassification;
  triggerMatches: AutomationTriggerMatchRecorder;
}): AutomationEvaluationSubscriberService {
  return AutomationEvaluationSubscriberService.create({
    triggers: input.triggers,
    graphActivity: input.graphActivity,
    traces: input.traces,
    evaluationFilters: AutomationEvaluationTriggerFilterService.create(input.traces),
    triggerMatches: input.triggerMatches,
    matchRecordMetrics: AutomationMatchRecordMetricsService.create(),
  });
}

export {
  createAutomationSettlement,
  type AutomationPersistCeiling,
  type AutomationRunawayCollaborator,
  type AutomationSettlement,
  type AutomationSettlementRepositories,
} from "./app/automation-composition.build.ts";

/**
 * The durable automation rows a composing process writes through, each built here rather than by
 * naming the Prisma class: a process holds the client, the module holds the choice of what reads
 * and writes it (private-runtime-export drive, dev/docs/plans/private-runtime-export-drive.md §3d).
 */
export function createAutomationTriggers(
  database: TriggerDatabase,
  clock: AutomationClock,
): TriggerRepository {
  return PrismaTriggerRepository.create(database, clock);
}

/** The trigger-sent ledger a graph alert reads before it fires twice. */
export function createAutomationGraphTriggerSent(
  database: GraphTriggerSentDatabase,
): GraphTriggerSentRepository {
  return PrismaGraphTriggerSentRepository.create(database);
}

/** The webhook deliveries an automation records and later prunes. */
export function createAutomationWebhookDeliveries(
  database: WebhookDeliveryDatabase,
): WebhookDeliveryRepository {
  return PrismaWebhookDeliveryRepository.create(database);
}

/** The custom graphs a report schedule renders from. */
export function createAutomationCustomGraphs(database: CustomGraphDatabase): CustomGraphRepository {
  return PrismaCustomGraphRepository.create(database);
}

/** The trace triggers an ingested trace is matched against. */
export function createAutomationTraceTriggerCatalogue(input: {
  prisma: AutomationTraceTriggerCatalogueDatabase;
  clock: AutomationClock;
}): AutomationTraceTriggerCatalogueRepository {
  return PrismaAutomationTraceTriggerCatalogueRepository.create(input);
}
