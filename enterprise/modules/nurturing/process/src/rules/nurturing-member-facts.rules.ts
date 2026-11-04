// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioPersonTraits,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";

const TRACE_FACT_KINDS = ["trace_received", "first_trace_integrated"] as const;
const MEMBER_FACT_KINDS = [
  ...TRACE_FACT_KINDS,
  "coding_session_stored",
  "coding_agent_types",
  "coding_terminal_types",
  "coding_repo_count",
  "coding_session_days_first_3",
] as const;

export type TraceFactSignal = NurturingSignalOf<(typeof TRACE_FACT_KINDS)[number]>;
/** A fact about the organization that every active member's own profile carries. */
export type MemberFactSignal = NurturingSignalOf<(typeof MEMBER_FACT_KINDS)[number]>;

/** What nurturing knows of a person's traces: a trace time can be missing where traces are not. */
export type KnownTraces = Readonly<{ hasTraces: boolean; lastTraceAt: number | null }>;

export function isMemberFact(signal: NurturingSignal): signal is MemberFactSignal {
  return (MEMBER_FACT_KINDS as readonly string[]).includes(signal.kind);
}

export function isTraceFact(signal: MemberFactSignal): signal is TraceFactSignal {
  return (TRACE_FACT_KINDS as readonly string[]).includes(signal.kind);
}

/** The traits every active member is told of a fact; milestones and events stay the admin's. */
export function memberFactTraits(signal: MemberFactSignal): Partial<CioPersonTraits> {
  switch (signal.kind) {
    case "trace_received":
    case "first_trace_integrated":
      return { has_traces: true, last_trace_at: unixSecondsOf(signal.occurredAt) };
    case "coding_session_stored":
      return { coding_last_session_at: unixSecondsOf(signal.occurredAt) };
    case "coding_agent_types":
      return { coding_agent_types: signal.agentTypes };
    case "coding_terminal_types":
      return { coding_terminal_types: signal.terminalTypes };
    case "coding_repo_count":
      return { coding_repo_count: signal.codingRepoCount };
    case "coding_session_days_first_3":
      return { coding_session_days_first_3: signal.codingSessionDaysFirst3 };
    default: {
      signal satisfies never;
      return {};
    }
  }
}

/** What a member other than the admin is told of the organization's first coding session. */
export function firstSessionMemberTraits(
  signal: NurturingSignalOf<"coding_agent_first_session">,
): Partial<CioPersonTraits> {
  return {
    coding_first_session_at: unixSecondsOf(signal.occurredAt),
    coding_agent_types: signal.agentTypes,
  };
}

/**
 * A person's traces as traits: false only for someone nurturing knows has none anywhere, and
 * nothing at all where the read failed (null), as a guess could overwrite a true.
 */
export function knownTraceTraits(
  traces: KnownTraces | null,
): Partial<Pick<CioPersonTraits, "has_traces" | "last_trace_at">> {
  if (!traces) return {};
  if (!traces.hasTraces) return { has_traces: false };
  return {
    has_traces: true,
    ...(traces.lastTraceAt === null ? {} : { last_trace_at: unixSecondsOf(traces.lastTraceAt) }),
  };
}
