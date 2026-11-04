// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";

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
