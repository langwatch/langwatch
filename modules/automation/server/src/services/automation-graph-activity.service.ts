import type { AnalyticsService } from "@langwatch/analytics-contract";
import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  TriggerSummary,
} from "@langwatch/automation-contract";
import {
  AutomationGraphActivity,
  type AutomationProjectIdentityPort,
} from "../app/automation.infrastructure.ts";
import type { AutomationClock } from "../app/automation.infrastructure.ts";
import {
  type AutomationDispatchError,
  type AutomationLogger,
} from "./automation-graph-runtime.service.ts";
import { type AutomationSlackBotTokenDecryptor } from "./automation-slack-secrets.service.ts";
import type { AutomationGraphDelivery } from "../app/automation.infrastructure.ts";
import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type { AutomationWebhookProvider } from "../services/automation-webhook-secrets.service.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";
import type { AutomationEmailCapService } from "./email-cap.service.ts";
import { GraphAlertDispatchService } from "./graph-alert-dispatch.service.ts";
import { GraphTriggerEvaluatorService } from "./graph-trigger-evaluator.service.ts";

/**
 * The graph-alert vertical, composed from repository interfaces and ports.
 *
 * The whole path behind the two questions Trace's real-time subscriber asks:
 * read the project's graph automations, re-evaluate one, and — when it fires —
 * render its template and hand the result to whichever channel the author
 * chose. Deliberately NOT here: the heartbeat sweep and persist-cap breach
 * containment, which need collaborators this path never reaches.
 */
export class AutomationGraphActivityService implements AutomationGraphActivity {
  static create(input: {
    triggers: TriggerRepository;
    customGraphs: CustomGraphRepository;
    graphTriggerSent: GraphTriggerSentRepository;
    /** The suppression, send-claim and webhook-log half a dispatched alert writes. */
    persistence: AutomationGraphDelivery;
    clock: AutomationClock;
    projects: AutomationProjectIdentityPort;
    analytics: AnalyticsService;
    /** The process's outbound transports: mail, Slack, webhook. */
    delivery: AutomationNotificationDelivery;
    webhooks: AutomationWebhookProvider;
    slackTokens: AutomationSlackBotTokenDecryptor;
    emailCaps: AutomationEmailCapService;
    logger: AutomationLogger;
    dispatchErrors: AutomationDispatchError;
    baseHost: string;
    emailHourlyCap: number;
    tenantDailyCap: number;
  }): AutomationGraphActivityService {
    return new AutomationGraphActivityService(
      ActiveTriggerCacheService.create({ triggers: input.triggers, clock: input.clock }),
      GraphTriggerEvaluatorService.create({
        triggers: input.triggers,
        customGraphs: input.customGraphs,
        projects: input.projects,
        analytics: input.analytics,
        triggerSent: input.graphTriggerSent,
        notifier: GraphAlertDispatchService.create({
          persistence: input.persistence,
          emailCaps: input.emailCaps,
          delivery: input.delivery,
          webhooks: input.webhooks,
          clock: input.clock,
          emailHourlyCap: input.emailHourlyCap,
          tenantDailyCap: input.tenantDailyCap,
        }),
        logger: input.logger,
        slackTokens: input.slackTokens,
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
