// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { z } from "zod";

import type { AnomalyAlertDeliveryOutbox } from "../services/anomaly-alert-dispatcher.service.ts";
import {
  ANOMALY_ALERT_DELIVERY_PROCESS_KEY,
  ANOMALY_ALERT_DELIVERY_PROCESS_NAME,
  ANOMALY_ALERT_DELIVERY_REQUEST_INTENT,
  ANOMALY_ALERT_DELIVERY_RETENTION_MS,
  ANOMALY_ALERT_EVENT_TYPE,
  type AnomalyAlertDeliveryIntent,
  anomalyAlertDeliveryKey,
} from "./anomaly-alert-delivery.process.ts";

/** The worker's side: one requestDelivery per intent, under the key a retry repeats. */
export function requestAnomalyAlertDelivery(
  webhooks: Pick<WebhookApi, "requestDelivery">,
): IntentExecutor<AnomalyAlertDeliveryIntent> {
  return async ({ organizationId, ruleId, alertId, endpointId, body }) => {
    await webhooks.requestDelivery({
      organizationId,
      destinationId: endpointId,
      message: {
        type: ANOMALY_ALERT_EVENT_TYPE,
        idempotencyKey: anomalyAlertDeliveryKey({ alertId, endpointId }),
        body,
      },
      source: { module: "governance", ref: ruleId },
    });
  };
}

/** The daily prune of delivered intents. */
export function pruneAnomalyAlertDeliveries(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: ANOMALY_ALERT_DELIVERY_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - ANOMALY_ALERT_DELIVERY_RETENTION_MS,
    });
  };
}

/** The dispatcher's side: the intent appended to governance's own outbox, keyed once per alert. */
export class OutboxAnomalyAlertDelivery implements AnomalyAlertDeliveryOutbox {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxAnomalyAlertDelivery {
    return new OutboxAnomalyAlertDelivery(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record(intent: AnomalyAlertDeliveryIntent): Promise<void> {
    await this.processStore.appendIntents({
      ref: {
        processName: ANOMALY_ALERT_DELIVERY_PROCESS_NAME,
        projectId: intent.organizationId,
        processKey: ANOMALY_ALERT_DELIVERY_PROCESS_KEY,
      },
      tenantId: intent.organizationId,
      sourceEventId: null,
      messages: [
        {
          messageKey: anomalyAlertDeliveryKey(intent),
          intentType: ANOMALY_ALERT_DELIVERY_REQUEST_INTENT,
          payload: {
            organizationId: intent.organizationId,
            ruleId: intent.ruleId,
            alertId: intent.alertId,
            endpointId: intent.endpointId,
            body: z.json().parse(intent.body),
          },
          traceCarrier: {},
        },
      ],
      now: nowInstant().epochMilliseconds,
    });
  }
}
