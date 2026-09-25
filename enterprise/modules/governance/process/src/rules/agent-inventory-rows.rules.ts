// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent } from "@langwatch/agent-contract";
import type { AgentSource, GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import { toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

export type RegisteredAgentRecord = Pick<
  Agent,
  "id" | "name" | "environment" | "ownerUserId" | "createdAt" | "lastSeenAt"
>;

export type DiscoveredAgentRecord = {
  id: string;
  provider: string;
  displayText: string;
  firstSeenAt: Instant;
  lastSeenAt: Instant;
};

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Whole units since `at`, floored at zero so a clock skew never reads as negative. */
function elapsed({ at, now, unitMs }: { at: TimeInput; now: Instant; unitMs: number }): number {
  return Math.max(0, Math.floor((now.epochMilliseconds - toEpochMs(at)) / unitMs));
}

/**
 * A connected agent (ADR-128) as a row. Only presence (`lastSeenAt`) fills "last active", and
 * registration fills "registered". Its config names no model, so the model list is empty.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function registeredAgentRow({
  agent,
  ownerName,
  now,
}: {
  agent: RegisteredAgentRecord;
  ownerName: string | null;
  now: Instant;
}): GovernanceAgentRow {
  return {
    id: `registered:${agent.id}`,
    name: agent.name,
    environment: agent.environment ?? null,
    owner: ownerName,
    models: [],
    source: "custom",
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo: agent.lastSeenAt
      ? elapsed({ at: agent.lastSeenAt, now, unitMs: MINUTE_MS })
      : null,
    health: null,
    registeredDaysAgo: elapsed({ at: agent.createdAt, now, unitMs: DAY_MS }),
  };
}

/**
 * A provider-listed agent as a row. A provider's place is not a stage, a sync date is neither
 * activity nor registration, and no provider field names an owner: all stay null.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
export function discoveredAgentRow({
  agent,
  source,
}: {
  agent: DiscoveredAgentRecord;
  source: AgentSource;
}): GovernanceAgentRow {
  return {
    id: `discovered:${agent.id}`,
    name: agent.displayText,
    environment: null,
    owner: null,
    models: [],
    source,
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo: null,
    health: null,
    registeredDaysAgo: null,
  };
}
