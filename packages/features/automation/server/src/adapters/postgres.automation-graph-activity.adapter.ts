import type { AnalyticsService } from "@langwatch/analytics-contract";
import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  SlackActionParams,
  TriggerSummary,
} from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  AutomationGraphActivityPort,
  type AutomationProjectIdentityPort,
} from "../ports/automation-graph-activity.port";
import type { AutomationClockPort } from "../ports/automation-clock.port";
import {
  AutomationSlackBotTokenDecryptorPort,
  type AutomationDispatchErrorPort,
  type AutomationLoggerPort,
} from "../ports/automation-graph.port";
import type { AutomationNotificationDeliveryPort } from "../ports/automation-notification-delivery.port";
import { PrismaCustomGraphRepository } from "../repositories/prisma/prisma.custom-graph.repository";
import { PrismaGraphTriggerSentRepository } from "../repositories/prisma/prisma.graph-trigger-sent.repository";
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository";
import { ActiveTriggerCacheService } from "../services/active-trigger-cache.service";
import type { AutomationEmailCapService } from "../services/email-cap.service";
import { GraphAlertDispatchService } from "../services/graph-alert-dispatch.service";
import { GraphTriggerEvaluatorService } from "../services/graph-trigger-evaluator.service";
import { PostgresAutomationGraphDeliveryAdapter } from "./postgres.automation-graph-delivery.adapter";
import { SlackProviderAdapter, type AutomationSecretCrypto } from "./slack-provider.adapter";
import { WebhookProviderAdapter } from "./webhook-provider.adapter";

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
  "trigger" | "customGraph" | "triggerSent" | "emailSuppression" | "webhookEndpointDelivery"
>;

/**
 * The graph-alert vertical, composed from a database and a set of transports.
 *
 * This is the whole path behind the two questions Trace's real-time subscriber
 * asks: read the project's graph automations, re-evaluate one, and — when it
 * fires — render its template and hand the result to whichever channel the
 * author chose. Everything between those ends is the feature's: the
 * open/resolve incident bookkeeping, the per-recipient send claims, the hourly
 * and tenant email ceilings, the suppression list, the webhook secret
 * decryption.
 *
 * What a process supplies is what a process owns — a Prisma client, a clock,
 * the two capability services this feature reads through
 * (`ProjectService`/`AnalyticsService`), the outbound transports, and the
 * cipher its stored credentials were written under. Nothing here reads an
 * environment, opens a connection or chooses a gateway, which is what lets a
 * test compose the whole vertical against fakes.
 *
 * ## What is deliberately NOT composed here
 *
 * The graph half of Automation has three more entry points, and each needs a
 * collaborator this path never reaches:
 *
 *   - `decideGraphTriggerHeartbeat` — the sweep's backstop, which needs a
 *     ClickHouse recency read per project.
 *   - `handlePersistCapBreach` — runaway containment, which needs a notifier
 *     that mails organization admins and a Redis claim.
 *   - the report schedules, test fires and persist-cap ledger of the full
 *     `AutomationService`.
 *
 * Composing them as no-ops to widen the constructor would put a collaborator
 * in the graph that nothing calls and that nobody would notice was wrong. A
 * process that needs them composes `PostgresAutomationAdapter` instead, which
 * asks for all of it and means it.
 */
export class PostgresAutomationGraphActivityAdapter extends AutomationGraphActivityPort {
  static create(input: {
    /** The one database client the composing process opened. */
    prisma: AutomationGraphActivityDatabase;
    clock: AutomationClockPort;
    projects: AutomationProjectIdentityPort;
    analytics: AnalyticsService;
    /** The process's outbound transports: mail, Slack, webhook. */
    delivery: AutomationNotificationDeliveryPort;
    /** Reads the Slack bot tokens and webhook secrets this deployment wrote. */
    crypto: AutomationSecretCrypto;
    emailCaps: AutomationEmailCapService;
    logger: AutomationLoggerPort;
    /** How the process's queue tells a permanent failure from a retryable one. */
    dispatchErrors: AutomationDispatchErrorPort;
    /** The deployment's own origin; every link in an alert is built from it. */
    baseHost: string;
    emailHourlyCap: number;
    tenantDailyCap: number;
  }): PostgresAutomationGraphActivityAdapter {
    const triggers = PrismaTriggerRepository.create(input.prisma, input.clock);
    const persistence = PostgresAutomationGraphDeliveryAdapter.create({
      database: input.prisma,
      clock: input.clock,
    });

    return new PostgresAutomationGraphActivityAdapter(
      ActiveTriggerCacheService.create({ triggers, clock: input.clock }),
      GraphTriggerEvaluatorService.create({
        triggers,
        customGraphs: PrismaCustomGraphRepository.create(input.prisma),
        projects: input.projects,
        analytics: input.analytics,
        triggerSent: PrismaGraphTriggerSentRepository.create(input.prisma),
        notifier: GraphAlertDispatchService.create({
          persistence,
          emailCaps: input.emailCaps,
          delivery: input.delivery,
          webhooks: WebhookProviderAdapter.create(input.crypto),
          clock: input.clock,
          emailHourlyCap: input.emailHourlyCap,
          tenantDailyCap: input.tenantDailyCap,
        }),
        logger: input.logger,
        slackTokens: new SlackBotTokenDecryptor(SlackProviderAdapter.create(input.crypto)),
        dispatchErrors: input.dispatchErrors,
        clock: input.clock,
        baseHost: input.baseHost,
      }),
    );
  }

  private constructor(
    private readonly active: ActiveTriggerCacheService,
    private readonly evaluator: GraphTriggerEvaluatorService,
  ) {
    super();
  }

  getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.active.getActiveGraphTriggersForProject(projectId);
  }

  evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return this.evaluator.evaluate(input);
  }
}

/**
 * Narrows the Slack provider to the one thing evaluation asks of it.
 *
 * `SlackProviderAdapter` also persists and redacts action parameters, which is
 * the drawer's business, not this path's. The wrapper is what keeps the
 * evaluator's dependency honest — and it is a class rather than an object
 * literal because the port it satisfies is nominal.
 */
class SlackBotTokenDecryptor extends AutomationSlackBotTokenDecryptorPort {
  constructor(private readonly provider: SlackProviderAdapter) {
    super();
  }

  tryDecrypt(params: SlackActionParams): string | null {
    return this.provider.tryDecrypt(params);
  }
}
