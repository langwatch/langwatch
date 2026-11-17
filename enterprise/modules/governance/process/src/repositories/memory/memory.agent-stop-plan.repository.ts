// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentStopPlanTarget } from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";

import { stopTimestamp } from "../../features/kill-switch/rules/agent-stop.rules.ts";
import {
  type AgentStopPlanCount,
  type AgentStopPlanReplacement,
  AgentStopPlanRepository,
  type StoredAgentStopPlan,
  type StoredAgentStopPlanTarget,
} from "../agent-stop-plan.repository.ts";

export class MemoryAgentStopPlanRepository extends AgentStopPlanRepository {
  private readonly plans = new Map<string, StoredAgentStopPlanTarget[]>();
  private readonly versions = new Map<string, { version: number; updatedAt: string }>();

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

  async getPlan({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlan> {
    const key = this.key(organizationId, agentId);
    const header = this.versions.get(key);
    return {
      version: header?.version ?? 0,
      updatedAt: header?.updatedAt ?? null,
      targets: structuredClone(this.plans.get(key) ?? []),
    };
  }

  async replaceTargets({
    organizationId,
    agentId,
    targets,
    expectedVersion,
    whileLocked,
  }: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopPlanTarget[];
    expectedVersion?: number;
    whileLocked?: () => Promise<void>;
  }): Promise<AgentStopPlanReplacement> {
    const key = this.key(organizationId, agentId);
    const version = this.versions.get(key)?.version ?? 0;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      return { outcome: "conflict", version };
    }
    await whileLocked?.();
    const updatedAt = stopTimestamp(nowInstant().epochMilliseconds);
    this.versions.set(key, { version: version + 1, updatedAt });
    const stored = targets.map((target) => ({ ...structuredClone(target), updatedAt }));
    if (stored.length === 0) this.plans.delete(key);
    else this.plans.set(key, stored);
    return { outcome: "saved", plan: await this.getPlan({ organizationId, agentId }) };
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
