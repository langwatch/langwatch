// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { OCSF_EVENT_TYPE } from "@langwatch/enterprise-governance-contract";
import type { IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { z } from "zod";

import type { OcsfPushOutbox } from "../services/ocsf-siem-push.service.ts";
import {
  OCSF_PUSH_PROCESS_KEY,
  OCSF_PUSH_PROCESS_NAME,
  OCSF_PUSH_REQUEST_INTENT,
  OCSF_PUSH_RETENTION_MS,
  type OcsfPushIntent,
  ocsfPushDeliveryKey,
} from "./ocsf-push-delivery.process.ts";

/** The worker's side: one requestDelivery per intent, under the key a retry repeats. */
export function requestOcsfPushDelivery(
  webhooks: Pick<WebhookApi, "requestDelivery">,
): IntentExecutor<OcsfPushIntent> {
  return async ({ organizationId, endpointId, eventId, body }) => {
    const idempotencyKey = ocsfPushDeliveryKey({ eventId, endpointId });
    await webhooks.requestDelivery({
      organizationId,
      destinationId: endpointId,
      message: { type: OCSF_EVENT_TYPE, idempotencyKey, body },
      source: { module: "governance", ref: idempotencyKey },
    });
  };
}

/** The daily prune of delivered intents. */
export function pruneOcsfPushDeliveries(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: OCSF_PUSH_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - OCSF_PUSH_RETENTION_MS,
    });
  };
}

/** The push service's side: intents appended to governance's own outbox, per event and endpoint. */
export class OutboxOcsfPushDelivery implements OcsfPushOutbox {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxOcsfPushDelivery {
    return new OutboxOcsfPushDelivery(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record(intents: readonly OcsfPushIntent[]): Promise<void> {
    const first = intents[0];
    if (!first) return;
    await this.processStore.appendIntents({
      ref: {
        processName: OCSF_PUSH_PROCESS_NAME,
        projectId: first.organizationId,
        processKey: OCSF_PUSH_PROCESS_KEY,
      },
      tenantId: first.organizationId,
      sourceEventId: null,
      messages: intents.map((intent) => ({
        messageKey: ocsfPushDeliveryKey(intent),
        intentType: OCSF_PUSH_REQUEST_INTENT,
        payload: {
          organizationId: intent.organizationId,
          endpointId: intent.endpointId,
          eventId: intent.eventId,
          body: z.json().parse(intent.body),
        },
        traceCarrier: {},
      })),
      now: nowInstant().epochMilliseconds,
    });
  }
}
