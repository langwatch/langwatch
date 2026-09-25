import type { IntentContext } from "@langwatch/eventing";
import { isDispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import type { AutomationClock, AutomationProjectDirectory } from "../app/automation.members.ts";
import { AutomationSettlementExecutor } from "../app/automation.members.ts";
import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "../eventing/trigger-settlement.intent.ts";
import { TRIGGER_SETTLEMENT_INTENT_TYPES } from "../eventing/trigger-settlement.intent.ts";
import type { AutomationSettlementLedgerRepository } from "../repositories/automation-settlement-ledger.repository.ts";
import type { AutomationSettlementTraceRepository } from "../repositories/automation-settlement-read.repository.ts";
import type { AutomationSettlementObservability } from "../services/automation-settlement-observability.service.ts";
import type { AutomationSlackProvider } from "../services/automation-slack-secrets.service.ts";
import type { AutomationWebhookProvider } from "../services/automation-webhook-secrets.service.ts";
import type { AutomationSettlementMatchConfirmation } from "./automation-settlement-match-confirmation.service.ts";
import type { AutomationEmailCapService } from "./email-cap.service.ts";
import type { AutomationPersistActionService } from "./persist-action.service.ts";
import { TriggerSettlementNotificationService } from "./trigger-settlement-notification.service.ts";
import { TriggerSettlementPersistenceService } from "./trigger-settlement-persistence.service.ts";

const logger = createLogger("langwatch:automation:settlement-dispatch");

type SettlementComposition = {
  automation: AutomationSettlementLedgerRepository;
  projects: AutomationProjectDirectory;
  traces: AutomationSettlementTraceRepository;
  confirmation: AutomationSettlementMatchConfirmation;
  persistActions: AutomationPersistActionService;
  delivery: AutomationNotificationDelivery;
  emailCaps: AutomationEmailCapService;
  slack: AutomationSlackProvider;
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
      this.rethrowIfRetryable(error, {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        intent: TRIGGER_SETTLEMENT_INTENT_TYPES.NOTIFY_DIGEST,
        attempt: context.attempt,
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
      this.rethrowIfRetryable(error, {
        projectId: context.projectId,
        triggerId: payload.triggerId,
        traceCount: traceIds.length,
        intent: TRIGGER_SETTLEMENT_INTENT_TYPES.PERSIST_MATCH,
        attempt: context.attempt,
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

  private rethrowIfRetryable(error: unknown, context: Record<string, unknown>): void {
    const retryable = isDispatchError(error) ? error.retryable : true;
    const handled = error instanceof Error ? error : new Error(String(error));
    logger.error({ ...context, retryable, error: handled.message }, "Settlement dispatch failed");
    this.composition.observability.capture(handled, context);
    if (retryable) {
      throw error;
    }
  }
}
