// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentStopPlanTarget } from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";

import { stopTimestamp } from "../../features/kill-switch/rules/agent-stop.rules.ts";
import {
  type AgentStopPlanCount,
  AgentStopPlanRepository,
  type StoredAgentStopPlanTarget,
} from "../agent-stop-plan.repository.ts";

export class MemoryAgentStopPlanRepository extends AgentStopPlanRepository {
  private readonly plans = new Map<string, StoredAgentStopPlanTarget[]>();

  private constructor() {
    super();
  }

  static create(): MemoryAgentStopPlanRepository {
    return new MemoryAgentStopPlanRepository();
  }

  private key(organizationId: string, agentId: string): string {
    return `${organizationId}\u0000${agentId}`;
  }

  async findTargets({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlanTarget[]> {
    return structuredClone(this.plans.get(this.key(organizationId, agentId)) ?? []);
  }

  async replaceTargets({
    organizationId,
    agentId,
    targets,
  }: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopPlanTarget[];
  }): Promise<StoredAgentStopPlanTarget[]> {
    const updatedAt = stopTimestamp(nowInstant().epochMilliseconds);
    const stored = targets.map((target) => ({ ...structuredClone(target), updatedAt }));
    if (stored.length === 0) this.plans.delete(this.key(organizationId, agentId));
    else this.plans.set(this.key(organizationId, agentId), stored);
    return structuredClone(stored);
  }

  async findPlanCounts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentStopPlanCount[]> {
    const prefix = `${organizationId}\u0000`;
    return [...this.plans.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, targets]) => ({
        agentId: key.slice(prefix.length),
        targetCount: targets.length,
      }));
  }

  async findAgentIdsByAwsConnection({
    organizationId,
    awsConnectionId,
  }: {
    organizationId: string;
    awsConnectionId: string;
  }): Promise<string[]> {
    const prefix = `${organizationId}\u0000`;
    return [...this.plans.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .filter(([, targets]) =>
        targets.some(
          ({ target }) =>
            target.kind === "bedrock_agent_alias" && target.awsConnectionId === awsConnectionId,
        ),
      )
      .map(([key]) => key.slice(prefix.length));
  }
}
