// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";

import { utcDayOffset } from "./nurturing-time.rules.ts";

type AdminFact = Readonly<{
  data: CodingAgentSessionStoredEventData;
  adminUserId: string;
}>;

/** The project's latest stored session, against the admin; Customer.io debounces it per project. */
export function codingSessionStoredSignal({
  data,
  adminUserId,
}: AdminFact): NurturingSignalOf<"coding_session_stored"> {
  return {
    kind: "coding_session_stored",
    sourceEventId: `${data.projectId}:${data.sessionId}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
  };
}

/** A new UTC day counted; keyed by the organization and day, so one per organization per day. */
export function codingActiveDaysSignal({
  data,
  adminUserId,
  organizationId,
  day,
  codingActiveDays,
}: AdminFact &
  Readonly<{
    organizationId: string;
    day: string;
    codingActiveDays: number;
  }>): NurturingSignalOf<"coding_active_days"> {
  return {
    kind: "coding_active_days",
    sourceEventId: `${organizationId}:${day}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
    codingActiveDays,
  };
}

/** A new agent type: the full sorted list, keyed by it, so each list is sent once. */
export function codingAgentTypesSignal({
  data,
  adminUserId,
  organizationId,
  agentTypes,
}: AdminFact &
  Readonly<{
    organizationId: string;
    agentTypes: readonly string[];
  }>): NurturingSignalOf<"coding_agent_types"> {
  const sorted = [...agentTypes].toSorted();
  return {
    kind: "coding_agent_types",
    sourceEventId: `${organizationId}:${sorted.join(",")}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
    agentTypes: sorted,
  };
}

/** A new terminal type: the full sorted list, keyed by it, so each list is sent once. */
export function codingTerminalTypesSignal({
  data,
  adminUserId,
  organizationId,
  terminalTypes,
}: AdminFact &
  Readonly<{
    organizationId: string;
    terminalTypes: readonly string[];
  }>): NurturingSignalOf<"coding_terminal_types"> {
  const sorted = [...terminalTypes].toSorted();
  return {
    kind: "coding_terminal_types",
    sourceEventId: `${organizationId}:${sorted.join(",")}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
    terminalTypes: sorted,
  };
}

/** A new repo: the count alone, keyed by it, so each count is sent once. */
export function codingRepoCountSignal({
  data,
  adminUserId,
  organizationId,
  codingRepoCount,
}: AdminFact &
  Readonly<{
    organizationId: string;
    codingRepoCount: number;
  }>): NurturingSignalOf<"coding_repo_count"> {
  return {
    kind: "coding_repo_count",
    sourceEventId: `${organizationId}:${codingRepoCount}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
    codingRepoCount,
  };
}

/** Days 0, 1 and 2 from the organization's creation are the ones that count. */
const LAST_FIRST_DAYS_OFFSET = 2;

/**
 * The first-three-days offsets the sessions fall on. None once day 2 has passed, whatever the
 * sessions' own times say: the value is never sent after day 2, even for a late or re-folded one.
 */
export function codingSessionDayOffsets({
  organizationCreatedAt,
  occurredAts,
  now,
}: Readonly<{
  organizationCreatedAt: number;
  occurredAts: readonly number[];
  now: number;
}>): number[] {
  if (utcDayOffset({ from: organizationCreatedAt, to: now }) > LAST_FIRST_DAYS_OFFSET) return [];
  const offsets = occurredAts.map((to) => utcDayOffset({ from: organizationCreatedAt, to }));
  return [...new Set(offsets)].filter((offset) => offset >= 0 && offset <= LAST_FIRST_DAYS_OFFSET);
}

/** A new day of the first three: the count, keyed by it, so each count is sent once. */
export function codingSessionDaysFirst3Signal({
  data,
  adminUserId,
  organizationId,
  codingSessionDaysFirst3,
}: AdminFact &
  Readonly<{
    organizationId: string;
    codingSessionDaysFirst3: number;
  }>): NurturingSignalOf<"coding_session_days_first_3"> {
  return {
    kind: "coding_session_days_first_3",
    sourceEventId: `${organizationId}:${codingSessionDaysFirst3}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
    codingSessionDaysFirst3,
  };
}

/** The organization's first coding-agent session; keyed by the organization, so once, ever. */
export function codingAgentFirstSessionSignal({
  data,
  adminUserId,
  organizationId,
  agentTypes,
  memberUserIds,
}: AdminFact &
  Readonly<{
    organizationId: string;
    agentTypes: readonly string[];
    /** Every active member of the organization, for their uses_coding_agent. */
    memberUserIds: readonly string[];
  }>): NurturingSignalOf<"coding_agent_first_session"> {
  return {
    kind: "coding_agent_first_session",
    sourceEventId: organizationId,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: adminUserId,
    projectId: data.projectId,
    agentType: data.agentType,
    agentTypes: [...agentTypes].toSorted(),
    memberUserIds: [...memberUserIds],
  };
}
