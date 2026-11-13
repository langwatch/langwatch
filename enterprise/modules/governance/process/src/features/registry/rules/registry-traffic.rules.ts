// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Temporal } from "@langwatch/time";
import type { TraceAgentSeen } from "@langwatch/trace-contract";

import type { RegistryDraft } from "./registry-entry.rules.ts";

/** How far back traffic still keeps an observed agent active. */
export const REGISTRY_TRAFFIC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Distinct agent names read per project per reconcile. */
export const REGISTRY_TRAFFIC_LIMIT_PER_PROJECT = 200;

function normalised(name: string): string {
  return name.trim().toLowerCase();
}

/** `gen_ai.request.model` as the traces name it; `openai/gpt-5` names its provider. */
function modelOf(model: string | null): RegistryDraft["model"] {
  if (!model) return null;
  const slash = model.indexOf("/");
  return {
    provider: slash > 0 ? model.slice(0, slash) : null,
    model: slash > 0 ? model.slice(slash + 1) : model,
    parameters: {},
  };
}

/**
 * Agents the traces name that no listed source accounts for, as observed drafts flagged shadow.
 * A trace agent matches a listed one by `gen_ai.agent.id` equal to a LangWatch agent's id or a
 * provider's agent id, or by the same name ignoring case. Spec: specs/agent-registry.feature
 */
export function trafficAgentDrafts({
  seen,
  listed,
}: {
  seen: readonly { projectId: string; agents: readonly TraceAgentSeen[] }[];
  listed: readonly RegistryDraft[];
}): RegistryDraft[] {
  const listedNames = new Set(listed.map((draft) => normalised(draft.name)));
  const listedIds = new Set(listed.flatMap((draft) => draft.matchIds ?? []));
  const drafts: RegistryDraft[] = [];
  for (const { projectId, agents } of seen) {
    for (const agent of agents) {
      if (agent.agentId && listedIds.has(agent.agentId)) continue;
      if (listedNames.has(normalised(agent.agentName))) continue;
      drafts.push({
        sourceKey: `traffic:${projectId}:${agent.agentName}`,
        source: "traffic",
        management: "observed",
        shadow: true,
        kind: "traced_agent",
        name: agent.agentName,
        description: null,
        source_version: null,
        project_id: projectId,
        environment: null,
        owner: null,
        endpoints: [],
        model: modelOf(agent.model),
        instructions: null,
        capabilities: ["traced_agent"],
        tools: [],
        firstSeenAt: Temporal.Instant.fromEpochMilliseconds(agent.firstSeenMs),
        lastSeenAt: Temporal.Instant.fromEpochMilliseconds(agent.lastSeenMs),
      });
    }
  }
  return drafts;
}
