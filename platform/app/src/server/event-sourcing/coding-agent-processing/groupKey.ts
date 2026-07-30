import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";

/**
 * Dispatch-plane keys for the `coding_agent_session` aggregate (ADR-100).
 * Every lane is session-scoped, including both maps — they consume this
 * aggregate's own committed events, so the session is the natural batching
 * unit. The three command lanes stay separate: a command only emits events,
 * so they cannot race the fold's read-modify-write cycle.
 */

export function codingAgentSessionGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "codingAgentSession" },
    scope: {
      kind: "aggregate",
      aggregateType: "coding_agent_session",
      aggregateId: args.sessionId,
    },
  };
}

export function renderCodingAgentSessionGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): string {
  return renderGroupKey(codingAgentSessionGroupKey(args));
}

export function codingAgentTraceSessionsGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "codingAgentTraceSessions" },
    scope: {
      kind: "aggregate",
      aggregateType: "coding_agent_session",
      aggregateId: args.sessionId,
    },
  };
}

export function codingAgentSessionContributionsGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "codingAgentSessionContributions" },
    scope: {
      kind: "aggregate",
      aggregateType: "coding_agent_session",
      aggregateId: args.sessionId,
    },
  };
}

/** One command lane per command name, each scoped to the session — see the module docblock. */
export function codingAgentContributionCommandGroupKey(args: {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly command:
    | "contributeSpanFacts"
    | "contributeLogFacts"
    | "contributeMetricFacts";
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: args.command },
    scope: {
      kind: "aggregate",
      aggregateType: "coding_agent_session",
      aggregateId: args.sessionId,
    },
  };
}
