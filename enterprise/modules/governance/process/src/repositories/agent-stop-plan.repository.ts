// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentStopPlanTarget } from "@langwatch/enterprise-governance-contract";

/** One stored plan row: the target, in plan order, and when the plan last changed. */
export type StoredAgentStopPlanTarget = AgentStopPlanTarget & { updatedAt: string };

/** How many targets one agent's plan holds, for the Agents page. */
export type AgentStopPlanCount = { agentId: string; targetCount: number };

/** Each registry agent's kill switch stop plan (specs/agent-kill-switch.feature). */
export abstract class AgentStopPlanRepository {
  /** The agent's targets in plan order; empty when it has no plan. */
  abstract findTargets(input: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlanTarget[]>;
  /** Replaces every target of the agent at once; an empty list clears the plan. */
  abstract replaceTargets(input: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopPlanTarget[];
  }): Promise<StoredAgentStopPlanTarget[]>;
  /** Every agent of the organisation that holds a plan. */
  abstract findPlanCounts(input: { organizationId: string }): Promise<AgentStopPlanCount[]>;
}
