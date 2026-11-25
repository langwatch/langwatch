// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/**
 * Governance's anomaly-alert delivery outbox (ADR-167 Decision 1; request delivery Q1, 2026-10-05):
 * the dispatcher records one intent per alert and webhook endpoint, and its handler asks
 * WebhookApi.requestDelivery after commit. A daily wake prunes the delivered rows.
 */
export const ANOMALY_ALERT_DELIVERY_PROCESS_NAME = "anomalyAlertDelivery" as const;
export const ANOMALY_ALERT_DELIVERY_REQUEST_INTENT = "requestDelivery" as const;
export const ANOMALY_ALERT_DELIVERY_PRUNE_INTENT = "pruneDelivered" as const;
export const ANOMALY_ALERT_DELIVERY_PROCESS_KEY = "anomaly-alerts";
export const ANOMALY_ALERT_EVENT_TYPE = "governance.anomaly_alert.triggered" as const;
/** A requestDelivery answers at once; a day of retries covers a webhook outage. */
export const ANOMALY_ALERT_DELIVERY_MAX_ATTEMPTS = 12;
export const ANOMALY_ALERT_DELIVERY_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const ANOMALY_ALERT_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const anomalyAlertDeliveryIntentSchema = z.object({
  organizationId: z.string().min(1),
  ruleId: z.string().min(1),
  alertId: z.string().min(1),
  endpointId: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
});
export type AnomalyAlertDeliveryIntent = z.infer<typeof anomalyAlertDeliveryIntentSchema>;

export const anomalyAlertDeliveryPruneSchema = z.object({ scheduledFor: z.number().int() });
export const anomalyAlertDeliveryStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type AnomalyAlertDeliveryState = z.infer<typeof anomalyAlertDeliveryStateSchema>;
export const ANOMALY_ALERT_DELIVERY_INITIAL_STATE: AnomalyAlertDeliveryState = {
  lastPruneAt: null,
};

type AnomalyAlertDeliveryIntents = {
  [ANOMALY_ALERT_DELIVERY_REQUEST_INTENT]: IntentSpec<typeof anomalyAlertDeliveryIntentSchema>;
  [ANOMALY_ALERT_DELIVERY_PRUNE_INTENT]: IntentSpec<typeof anomalyAlertDeliveryPruneSchema>;
};

/** The one key per alert and endpoint: the outbox's dedup identity and the webhook's idempotency key. */
export function anomalyAlertDeliveryKey({
  alertId,
  endpointId,
}: {
  alertId: string;
  endpointId: string;
}): string {
  return `anomaly-alert:${alertId}:${endpointId}`;
}

export const anomalyAlertDeliveryPruneWake: WakeHandler<
  AnomalyAlertDeliveryState,
  AnomalyAlertDeliveryIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [
    ctx.intent(ANOMALY_ALERT_DELIVERY_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});
