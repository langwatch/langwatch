// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { z } from "zod";

import type { AgentRegistryDeliveryOutbox } from "../features/registry/services/agent-registry.service.ts";
import {
  AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
  AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
  AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
  AGENT_REGISTRY_DELIVERY_RETENTION_MS,
  type AgentRegistryDeliveryIntent,
  agentRegistryDeliveryKey,
} from "./agent-registry-delivery.process.ts";

/** The worker's side: one requestDelivery per intent, under the key a retry repeats. */
export function requestAgentRegistryDelivery(
  webhooks: Pick<WebhookApi, "requestDelivery">,
): IntentExecutor<AgentRegistryDeliveryIntent> {
  return async ({ organizationId, eventId, eventType, endpointId, body }) => {
    await webhooks.requestDelivery({
      organizationId,
      destinationId: endpointId,
      message: {
        type: eventType,
        idempotencyKey: agentRegistryDeliveryKey({ eventId, endpointId }),
        body,
      },
      source: { module: "governance", ref: eventId },
    });
  };
}

/** The daily prune of delivered intents. */
export function pruneAgentRegistryDeliveries(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - AGENT_REGISTRY_DELIVERY_RETENTION_MS,
    });
  };
}

/** The registry's side: intents appended to governance's own outbox, keyed per event and endpoint. */
export class OutboxAgentRegistryDelivery implements AgentRegistryDeliveryOutbox {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxAgentRegistryDelivery {
    return new OutboxAgentRegistryDelivery(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record(intents: readonly AgentRegistryDeliveryIntent[]): Promise<void> {
    const first = intents[0];
    if (!first) return;
    await this.processStore.appendIntents({
      ref: {
        processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
        projectId: first.organizationId,
        processKey: AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
      },
      tenantId: first.organizationId,
      sourceEventId: null,
      messages: intents.map((intent) => ({
        messageKey: agentRegistryDeliveryKey(intent),
        intentType: AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
        payload: {
          organizationId: intent.organizationId,
          eventId: intent.eventId,
          eventType: intent.eventType,
          endpointId: intent.endpointId,
          body: z.json().parse(intent.body),
        },
        traceCarrier: {},
      })),
      now: nowInstant().epochMilliseconds,
    });
  }
}
