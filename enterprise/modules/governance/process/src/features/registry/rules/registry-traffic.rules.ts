// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AgentRegistryEntry } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import type { TraceAgentSeen } from "@langwatch/trace-contract";

import type { RegistryDraft } from "./registry-entry.rules.ts";

/** How far back traffic still keeps an observed agent active. */
export const REGISTRY_TRAFFIC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Distinct agent names read per project per reconcile. */
export const REGISTRY_TRAFFIC_LIMIT_PER_PROJECT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The traffic read reaches back over the shadow window or the dormancy window, the longer. */
export function registryTrafficReadWindowMs(dormantAfterDays: number): number {
  return Math.max(REGISTRY_TRAFFIC_WINDOW_MS, dormantAfterDays * DAY_MS);
}

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
 * Whether a held traffic entry a read did not return stays, unless a listed source now accounts
 * for it: it was last seen inside the window (the read was overtaken by a newer sighting), or its
 * project's read is unsettled (traffic past the per-project cap, agents read incomplete).
 * Spec: specs/agent-registry.feature
 */
export function keepsTrafficInWindow({
  sinceMs,
  projectIds,
  unsettledProjectIds = new Set(),
  listed,
}: {
  sinceMs: number;
  projectIds: readonly string[];
  unsettledProjectIds?: ReadonlySet<string>;
  listed: readonly RegistryDraft[];
}): (held: {
  entry: Pick<AgentRegistryEntry, "source" | "project_id" | "name" | "last_seen_at">;
}) => boolean {
  const live = new Set(projectIds);
  const accounts = listedAccounts(listed);
  const inWindow = (lastSeenAt: string | null) =>
    lastSeenAt !== null && Temporal.Instant.from(lastSeenAt).epochMilliseconds >= sinceMs;
  return ({ entry }) => {
    const projectId = entry.project_id;
    if (entry.source !== "traffic" || projectId === null || !live.has(projectId)) return false;
    if (accounts({ projectId, name: entry.name, agentId: null })) return false;
    return unsettledProjectIds.has(projectId) || inWindow(entry.last_seen_at);
  };
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
        dormant: false,
        platform: null,
        labels: {},
        owner_label: null,
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

type SeenInProject = { projectId: string; agents: readonly TraceAgentSeen[] };

/** The traced agents last seen at or after `sinceMs`, per project. */
export function seenSince({
  seen,
  sinceMs,
}: {
  seen: readonly SeenInProject[];
  sinceMs: number;
}): SeenInProject[] {
  return seen.map(({ projectId, agents }) => ({
    projectId,
    agents: agents.filter((agent) => agent.lastSeenMs >= sinceMs),
  }));
}

/**
 * Listed drafts with their dormancy: dormant when older than the window (first sighting or source
 * creation, the earlier) with no trace in it, matched as shadow detection matches. An unsettled
 * read keeps the held answer. Spec: specs/cloud-agent-discovery.feature
 */
export function withDormancy({
  listed,
  seen,
  nowMs,
  dormantAfterDays,
  unsettledProjectIds = new Set(),
}: {
  listed: readonly RegistryDraft[];
  seen: readonly SeenInProject[];
  nowMs: number;
  dormantAfterDays: number;
  unsettledProjectIds?: ReadonlySet<string>;
}): RegistryDraft[] {
  const windowMs = dormantAfterDays * DAY_MS;
  const sinceMs = nowMs - windowMs;
  const traced = seenSince({ seen, sinceMs });
  return listed.map((draft) => {
    const referenceMs = Math.min(
      draft.firstSeenAt.epochMilliseconds,
      draft.sourceCreatedAt?.epochMilliseconds ?? Number.POSITIVE_INFINITY,
    );
    if (nowMs - referenceMs < windowMs) return { ...draft, dormant: false };
    const accounted = listedAccounts([draft]);
    const isTraced = traced.some(({ projectId, agents }) =>
      agents.some((agent) =>
        accounted({ projectId, name: agent.agentName, agentId: agent.agentId }),
      ),
    );
    if (isTraced || draft.shadow) return { ...draft, dormant: false };
    const unsettled =
      draft.project_id === null
        ? unsettledProjectIds.size > 0
        : unsettledProjectIds.has(draft.project_id);
    if (unsettled) return { ...draft, dormant: false, dormancyUnsettled: true };
    return { ...draft, dormant: true };
  });
}
