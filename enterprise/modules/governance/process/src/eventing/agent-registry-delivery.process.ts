// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/**
 * The agent registry's webhook outbox (ADR-167 Decision 1, as anomaly alerts do): one intent per
 * change event and subscribed endpoint, whose handler asks WebhookApi.requestDelivery after commit.
 * A daily wake prunes delivered rows. Spec: specs/agent-registry.feature
 */
export const AGENT_REGISTRY_DELIVERY_PROCESS_NAME = "agentRegistryDelivery" as const;
export const AGENT_REGISTRY_DELIVERY_REQUEST_INTENT = "requestDelivery" as const;
export const AGENT_REGISTRY_DELIVERY_PRUNE_INTENT = "pruneDelivered" as const;
export const AGENT_REGISTRY_DELIVERY_PROCESS_KEY = "agent-registry";
/** A requestDelivery answers at once; a day of retries covers a webhook outage. */
export const AGENT_REGISTRY_DELIVERY_MAX_ATTEMPTS = 12;
export const AGENT_REGISTRY_DELIVERY_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const AGENT_REGISTRY_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const agentRegistryDeliveryIntentSchema = z.object({
  organizationId: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  endpointId: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
});
export type AgentRegistryDeliveryIntent = z.infer<typeof agentRegistryDeliveryIntentSchema>;

export const agentRegistryDeliveryPruneSchema = z.object({ scheduledFor: z.number().int() });
export const agentRegistryDeliveryStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type AgentRegistryDeliveryState = z.infer<typeof agentRegistryDeliveryStateSchema>;
export const AGENT_REGISTRY_DELIVERY_INITIAL_STATE: AgentRegistryDeliveryState = {
  lastPruneAt: null,
};

type AgentRegistryDeliveryIntents = {
  [AGENT_REGISTRY_DELIVERY_REQUEST_INTENT]: IntentSpec<typeof agentRegistryDeliveryIntentSchema>;
  [AGENT_REGISTRY_DELIVERY_PRUNE_INTENT]: IntentSpec<typeof agentRegistryDeliveryPruneSchema>;
};

/** One key per event and endpoint: the outbox's dedup identity and the webhook's idempotency key. */
export function agentRegistryDeliveryKey({
  eventId,
  endpointId,
}: {
  eventId: string;
  endpointId: string;
}): string {
  return `agent-registry:${eventId}:${endpointId}`;
}

export const agentRegistryDeliveryPruneWake: WakeHandler<
  AgentRegistryDeliveryState,
  AgentRegistryDeliveryIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [
    ctx.intent(AGENT_REGISTRY_DELIVERY_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});
