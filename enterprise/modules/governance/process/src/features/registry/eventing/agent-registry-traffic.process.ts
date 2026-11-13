// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/**
 * Traffic has no fact of its own to react to, so a scheduled pass re-reads it: every organisation
 * the registry holds is reconciled, which registers newly traced agents and flags them shadow.
 * The first pass of each UTC day walks every organisation. Spec: specs/agent-registry.feature
 */
export const AGENT_REGISTRY_TRAFFIC_PROCESS_NAME = "agentRegistryTraffic" as const;
export const AGENT_REGISTRY_TRAFFIC_INTERVAL_MS = 15 * 60 * 1000;
/** Outbox rows are bookkeeping, one per pass, pruned like every recurring process's. */
const AGENT_REGISTRY_TRAFFIC_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const agentRegistryTrafficPassSchema = z.object({ scheduledFor: z.number().int() });
export const agentRegistryTrafficStateSchema = z.object({ lastPassAt: z.number().nullable() });
type AgentRegistryTrafficState = z.infer<typeof agentRegistryTrafficStateSchema>;
export const AGENT_REGISTRY_TRAFFIC_INITIAL_STATE: AgentRegistryTrafficState = {
  lastPassAt: null,
};

type AgentRegistryTrafficIntents = { pass: IntentSpec<typeof agentRegistryTrafficPassSchema> };

export const agentRegistryTrafficWake: WakeHandler<
  AgentRegistryTrafficState,
  AgentRegistryTrafficIntents
> = (_state, ctx) => ({
  state: { lastPassAt: ctx.at },
  intents: [ctx.intent("pass", `pass:${ctx.at}`, { scheduledFor: ctx.at })],
});

/** One pass; a failed organisation is logged and left to the next trigger, never re-driven whole. */
export function runAgentRegistryTraffic(deps: {
  reconcile: (input: { everyOrganization: boolean }) => Promise<{ organizations: number }>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now: () => number;
}): () => Promise<void> {
  return async () => {
    const startedAt = deps.now();
    await deps.reconcile({
      everyOrganization: startedAt % DAY_MS < AGENT_REGISTRY_TRAFFIC_INTERVAL_MS,
    });
    await deps
      .deleteDispatchedBefore({
        processName: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
        before: startedAt - AGENT_REGISTRY_TRAFFIC_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
