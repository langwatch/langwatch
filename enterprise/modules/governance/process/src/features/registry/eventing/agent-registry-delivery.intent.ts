// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentExecutor, ProcessStore } from "@langwatch/eventing";
import {
  type NotificationService,
  WEB_PUSH_BODY_MAX,
  WEB_PUSH_TITLE_MAX,
} from "@langwatch/notification-contract";
import { nowInstant } from "@langwatch/time";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { z } from "zod";

import type {
  AgentRegistryDeliveryOutbox,
  AgentRegistryFanOut,
} from "../services/agent-registry.service.ts";
import {
  AGENT_REGISTRY_ALERT_INTENT,
  type AgentRegistryAlertIntent,
  agentRegistryAlertKey,
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

const AGENTS_PAGE_PATH = "/governance/agents";

function clipped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/**
 * The worker's side of a shadow alert: one web push to the admin, keyed by the event and the
 * admin so a retry queues nothing new. The push is recorded on the governance internal project.
 */
export function requestAgentRegistryAlert({
  notifications,
  governanceProjectId,
}: {
  notifications: Pick<NotificationService, "requestWebPushDelivery">;
  governanceProjectId: (organizationId: string) => Promise<string>;
}): IntentExecutor<AgentRegistryAlertIntent> {
  return async ({ organizationId, eventId, userId, agentId, agentName }) => {
    await notifications.requestWebPushDelivery({
      userId,
      projectId: await governanceProjectId(organizationId),
      idempotencyKey: agentRegistryAlertKey({ eventId, userId }),
      topic: `agent-registry:shadow:${agentId}`,
      urgency: "normal",
      message: {
        title: clipped(`New shadow agent: ${agentName}`, WEB_PUSH_TITLE_MAX),
        body: clipped(
          `Traces name ${agentName}, but no governance source lists it.`,
          WEB_PUSH_BODY_MAX,
        ),
        url: AGENTS_PAGE_PATH,
        tag: `agent-registry:shadow:${agentId}`,
      },
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

/**
 * The registry's side: intents appended to governance's own outbox, webhook deliveries keyed per
 * event and endpoint, shadow alerts per event and admin.
 */
export class OutboxAgentRegistryDelivery implements AgentRegistryDeliveryOutbox {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxAgentRegistryDelivery {
    return new OutboxAgentRegistryDelivery(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record({ organizationId, deliveries, alerts }: AgentRegistryFanOut): Promise<void> {
    if (deliveries.length === 0 && alerts.length === 0) return;
    await this.processStore.appendIntents({
      ref: {
        processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
        projectId: organizationId,
        processKey: AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
      },
      tenantId: organizationId,
      sourceEventId: null,
      messages: [
        ...deliveries.map((intent) => ({
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
        ...alerts.map((intent) => ({
          messageKey: agentRegistryAlertKey(intent),
          intentType: AGENT_REGISTRY_ALERT_INTENT,
          payload: { ...intent },
          traceCarrier: {},
        })),
      ],
      now: nowInstant().epochMilliseconds,
    });
  }
}
