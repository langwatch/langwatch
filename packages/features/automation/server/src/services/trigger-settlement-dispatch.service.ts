
import type { IntentContext } from "@langwatch/eventing";
import { isDispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";


import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "../intents/trigger-settlement.intent";
import { TRIGGER_SETTLEMENT_INTENT_TYPES } from "../intents/trigger-settlement.intent";
import type { AutomationClockPort } from "../ports/automation-clock.port";
import type { AutomationNotificationDeliveryPort } from "../ports/automation-notification-delivery.port";
import type {
  AutomationSlackProviderPort,
  AutomationWebhookProviderPort,
} from "../ports/automation-provider.port";
import type {
  AutomationSettlementMatchConfirmationPort,
  AutomationSettlementObservabilityPort,
} from "../ports/automation-settlement.port";
import { AutomationSettlementExecutorPort } from "../ports/automation-settlement.port";
import type { AutomationSettlementLedgerPort } from "../ports/automation-settlement-ledger.port";
import type { AutomationSettlementTraceReaderPort } from "../ports/automation-settlement-read.port";
import type { AutomationProjectIdentityPort } from "../ports/automation-graph-activity.port";
import type { AutomationEmailCapService } from "./email-cap.service";
import type { AutomationPersistActionService } from "./persist-action.service";
import { TriggerSettlementNotificationService } from "./trigger-settlement-notification.service";
import { TriggerSettlementPersistenceService } from "./trigger-settlement-persistence.service";

const logger = createLogger("langwatch:automation:settlement-dispatch");

type SettlementComposition = {
  automation: AutomationSettlementLedgerPort;
  projects: AutomationProjectIdentityPort;
  traces: AutomationSettlementTraceReaderPort;
  confirmation: AutomationSettlementMatchConfirmationPort;
  persistActions: AutomationPersistActionService;
  delivery: AutomationNotificationDeliveryPort;
  emailCaps: AutomationEmailCapService;
  slack: AutomationSlackProviderPort;
  webhooks: AutomationWebhookProviderPort;
  clock: AutomationClockPort;
  observability: AutomationSettlementObservabilityPort;
  baseHost: string;
  emailHourlyCap: number;
  tenantDailyCap: number;
};

export class AutomationSettlementDispatchService extends AutomationSettlementExecutorPort {
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
