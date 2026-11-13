import type { AgentRegistryEntry } from "@langwatch/enterprise-governance-contract";
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
 * Whether a listed source accounts for a traced agent: by `gen_ai.agent.id` equal to a LangWatch
 * agent's id or a provider's agent id, or by name ignoring case, a LangWatch agent's in its own
 * project, a provider agent's anywhere.
 */
function listedAccounts(
  listed: readonly RegistryDraft[],
): (agent: { projectId: string; name: string; agentId: string | null }) => boolean {
  const nameKey = (projectId: string | null, name: string) =>
    `${projectId ?? "*"}:${normalised(name)}`;
  const listedNames = new Set(listed.map((draft) => nameKey(draft.project_id, draft.name)));
  const listedIds = new Set(listed.flatMap((draft) => draft.matchIds ?? []));
  return ({ projectId, name, agentId }) =>
    (agentId !== null && listedIds.has(agentId)) ||
    listedNames.has(nameKey(projectId, name)) ||
    listedNames.has(nameKey(null, name));
}

/**
 * Whether a held traffic entry a read did not return stays: it was last seen inside the window,
 * so the read missed it (past the per-project cap, or overtaken by a newer sighting), unless a
 * listed source now accounts for it. Spec: specs/agent-registry.feature
 */
export function keepsTrafficInWindow({
  sinceMs,
  projectIds,
  listed,
}: {
  sinceMs: number;
  projectIds: readonly string[];
  listed: readonly RegistryDraft[];
}): (held: {
  entry: Pick<AgentRegistryEntry, "source" | "project_id" | "name" | "last_seen_at">;
}) => boolean {
  const live = new Set(projectIds);
  const accounts = listedAccounts(listed);
  return ({ entry }) =>
    entry.source === "traffic" &&
    entry.project_id !== null &&
    live.has(entry.project_id) &&
    entry.last_seen_at !== null &&
    Temporal.Instant.from(entry.last_seen_at).epochMilliseconds >= sinceMs &&
    !accounts({ projectId: entry.project_id, name: entry.name, agentId: null });
}

/**
 * Agents the traces name that no listed source accounts for, as observed drafts flagged shadow.
 * Spec: specs/agent-registry.feature
 */
export function trafficAgentDrafts({
  seen,
  listed,
}: {
  seen: readonly { projectId: string; agents: readonly TraceAgentSeen[] }[];
  listed: readonly RegistryDraft[];
}): RegistryDraft[] {
  const accounts = listedAccounts(listed);
  const drafts: RegistryDraft[] = [];
  for (const { projectId, agents } of seen) {
    for (const agent of agents) {
      if (accounts({ projectId, name: agent.agentName, agentId: agent.agentId })) continue;
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
