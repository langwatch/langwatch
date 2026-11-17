// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentStopPlanTarget } from "@langwatch/enterprise-governance-contract";

/** One stored plan row: the target, in plan order, and when the plan last changed. */
export type StoredAgentStopPlanTarget = AgentStopPlanTarget & { updatedAt: string };

/** One agent's plan as one read: its targets and the version they belong to. */
export type StoredAgentStopPlan = {
  /** 0 when the plan was never saved. */
  version: number;
  updatedAt: string | null;
  targets: StoredAgentStopPlanTarget[];
};

/** A save, or the newer version that refused it because the caller read an older one. */
export type AgentStopPlanReplacement =
  | { outcome: "saved"; plan: StoredAgentStopPlan }
  | { outcome: "conflict"; version: number };

/** How many targets one agent's plan holds, for the Agents page. */
export type AgentStopPlanCount = { agentId: string; targetCount: number };

/** Each registry agent's kill switch stop plan (specs/agent-kill-switch.feature). */
export abstract class AgentStopPlanRepository {
  /** The agent's targets in plan order; empty when it has no plan. */
  abstract findTargets(input: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlanTarget[]>;
  /** The agent's plan with its version, read together so the version names these targets. */
  abstract getPlan(input: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlan>;
  /**
   * Replaces every target at once and bumps the version; an empty list clears the plan. Writes of
   * one agent are serialised; given `expectedVersion`, a plan at another version is kept. With a
   * Bedrock target it also holds `awsConnectionsLockKey`; `whileLocked` runs right before the write.
   */
  abstract replaceTargets(input: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopPlanTarget[];
    expectedVersion?: number;
    whileLocked?: () => Promise<void>;
  }): Promise<AgentStopPlanReplacement>;
  /** Every agent of the organisation that holds a plan. */
  abstract findPlanCounts(input: { organizationId: string }): Promise<AgentStopPlanCount[]>;
  /** The agents whose plan holds a Bedrock target signing with the connection. */
  abstract findAgentIdsByAwsConnection(input: {
    organizationId: string;
    awsConnectionId: string;
  }): Promise<string[]>;
}
