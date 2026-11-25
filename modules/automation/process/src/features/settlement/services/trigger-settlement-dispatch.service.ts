import type { IntentContext } from "@langwatch/eventing";
import { refusesRetry } from "@langwatch/group-queue";
import { createLogger, createWarnThrottle } from "@langwatch/observability";

import type { AutomationNotificationDelivery } from "../../../channels/automation-notification-delivery.channel.ts";
import {
  AutomationSettlementExecutor,
  type LogOverflowIntent,
  type NotifyDigestIntent,
  type PersistMatchIntent,
  TRIGGER_SETTLEMENT_INTENT_TYPES,
} from "../../../eventing/trigger-settlement.intent.ts";
import type { AutomationSettlementLedgerRepository } from "../../../repositories/automation-settlement-ledger.repository.ts";
import type { AutomationSettlementTraceRepository } from "../../../repositories/automation-settlement-read.repository.ts";
import type { AutomationClock } from "../../../repositories/automation.repositories.ts";
import { isCustomerConfigurationRefusal } from "../../../rules/settlement-refusal.rules.ts";
import type { AutomationWebhookProvider } from "../../../services/automation-webhook-secrets.service.ts";
import type { AutomationProjectDirectory } from "../../../services/automation.service.ts";
import type { AutomationEmailCapService } from "../../runaway/services/email-cap.service.ts";
import type { AutomationPersistActionService } from "../../runaway/services/persist-action.service.ts";
import type { SlackDestinationService } from "../../slack/services/slack-destination.service.ts";
import type { AutomationSettlementMatchConfirmation } from "./automation-settlement-match-confirmation.service.ts";
import type { AutomationSettlementObservability } from "./automation-settlement-observability.service.ts";
import { TriggerSettlementNotificationService } from "./trigger-settlement-notification.service.ts";
import { TriggerSettlementPersistenceService } from "./trigger-settlement-persistence.service.ts";

const logger = createLogger("langwatch:automation:settlement-dispatch");
const REFUSAL_LOG_WINDOW_MS = 60 * 60 * 1000;

type SettlementComposition = {
  automation: AutomationSettlementLedgerRepository;
  projects: AutomationProjectDirectory;
  traces: AutomationSettlementTraceRepository;
  confirmation: AutomationSettlementMatchConfirmation;
  persistActions: AutomationPersistActionService;
  delivery: AutomationNotificationDelivery;
  emailCaps: AutomationEmailCapService;
  slackDestinations: Pick<
    SlackDestinationService,
    "findSlackDestination" | "getMissingDispatchError"
  >;
  webhooks: AutomationWebhookProvider;
  clock: AutomationClock;
  observability: AutomationSettlementObservability;
  baseHost: string;
  emailHourlyCap: number;
  tenantDailyCap: number;
};

export class AutomationSettlementDispatchService extends AutomationSettlementExecutor {
  private readonly notifications: TriggerSettlementNotificationService;
  private readonly persistence: TriggerSettlementPersistenceService;
  private readonly refusalLog = createWarnThrottle(REFUSAL_LOG_WINDOW_MS);

  private constructor(private readonly composition: SettlementComposition) {
    super();
    this.notifications = TriggerSettlementNotificationService.create(composition);
    this.persistence = TriggerSettlementPersistenceService.create(composition);
  }

  static create(composition: SettlementComposition): AutomationSettlementDispatchService {
    return new AutomationSettlementDispatchService(composition);
  }

  async notifyDigest(payload: NotifyDigestIntent, context: IntentContext): Promise<void> {
    try {
      await this.notifications.dispatch({
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceIds: payload.traceIds,
        messageKey: context.messageKey,
      });
    } catch (error) {
      this.rethrowIfRetryable({
        error,
        context: {
          projectId: context.projectId,
          triggerId: payload.triggerId,
          intent: TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
          attempt: context.attempt,
        },
      });
    }
  }

  async persistMatch(payload: PersistMatchIntent, context: IntentContext): Promise<void> {
    const traceIds = "traceIds" in payload ? payload.traceIds : [payload.traceId];
    try {
      await this.persistence.dispatch({
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceIds,
      });
    } catch (error) {
      this.rethrowIfRetryable({
        error,
        context: {
          projectId: context.projectId,
          triggerId: payload.triggerId,
          traceCount: traceIds.length,
          intent: TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
          attempt: context.attempt,
        },
      });
    }
  }

  async logOverflow(payload: LogOverflowIntent, context: IntentContext): Promise<void> {
    this.composition.observability.recordOverflow(payload.flushed);
    logger.warn(
      {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        flushed: payload.flushed,
        totalFlushed: payload.totalFlushed,
      },
      "Trigger settlement pending-match bound flushed oldest matches to immediate dispatch",
    );
  }

  /**
   * A refusal the customer fixes is a warning, once per automation per window,
   * and ends the dispatch. Anything else is captured once and rethrown when a
   * retry could succeed.
   */
  private rethrowIfRetryable({
    error,
    context,
  }: {
    error: unknown;
    context: Record<string, unknown> & { triggerId: string };
  }): void {
    const retryable = !refusesRetry(error);
    if (!retryable && isCustomerConfigurationRefusal(error)) {
      const suppressedRefusals = this.refusalLog.claim({
        key: `${context.triggerId}:${error.code}`,
        now: this.composition.clock.now().epochMilliseconds,
      });
      if (suppressedRefusals === undefined) return;
      logger.warn(
        {
          ...context,
          code: error.code,
          fault: error.fault,
          error: error.message,
          suppressedRefusals,
        },
        "Settlement dispatch refused by the automation's saved configuration; not retrying",
      );
      return;
    }

    const handled = error instanceof Error ? error : new Error(String(error));
    this.composition.observability.capture(handled, { ...context, retryable });
    if (retryable) {
      throw error;
    }
  }
}
