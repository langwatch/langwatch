// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentStopPlan,
  type AgentStopPlanTarget,
  type AgentStopTarget,
  AgentStopTargetInvalidError,
  DATABRICKS_GENIE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { generate } from "@langwatch/ksuid";

import type { AgentRegistryRepository } from "../../../repositories/agent-registry.repository.ts";
import type {
  AgentStopPlanCount,
  AgentStopPlanRepository,
} from "../../../repositories/agent-stop-plan.repository.ts";
import type { GovernanceAwsConnectionRepository } from "../../../repositories/governance-aws-connection.repository.ts";
import type { IngestionSourceRepository } from "../../../repositories/ingestion-source.repository.ts";
import { labelOfTarget } from "../rules/agent-stop.rules.ts";

interface AgentStopPlanDependencies {
  plans: AgentStopPlanRepository;
  registry: Pick<AgentRegistryRepository, "getEntry">;
  sources: Pick<IngestionSourceRepository, "findById">;
  awsConnections: Pick<GovernanceAwsConnectionRepository, "findByIds">;
  virtualKeys: Pick<GatewayApi, "findVirtualKeyById">;
  newId: () => string;
}

/**
 * Each registry agent's stop plan. A write names only what the organisation holds: its own
 * Databricks sources, AWS connections and gateway virtual keys, else it is refused by position.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export class AgentStopPlanService {
  private constructor(private readonly deps: AgentStopPlanDependencies) {}

  static create({
    newId = () => generate("stoptarget").toString(),
    ...deps
  }: Omit<AgentStopPlanDependencies, "newId"> & {
    newId?: () => string;
  }): AgentStopPlanService {
    return new AgentStopPlanService({ ...deps, newId });
  }

  async getPlan({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopPlan> {
    await this.deps.registry.getEntry({ organizationId, id: agentId });
    return this.planOf({ organizationId, agentId });
  }

  /** The plan's targets without the registry check, for a stop that has already read the entry. */
  async findTargets({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopPlanTarget[]> {
    return (await this.planOf({ organizationId, agentId })).targets;
  }

  findPlanCounts({ organizationId }: { organizationId: string }): Promise<AgentStopPlanCount[]> {
    return this.deps.plans.findPlanCounts({ organizationId });
  }

  async setPlan({
    organizationId,
    agentId,
    targets,
  }: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopTarget[];
  }): Promise<AgentStopPlan> {
    await this.deps.registry.getEntry({ organizationId, id: agentId });
    await this.validate({ organizationId, targets });
    const stored = await this.deps.plans.replaceTargets({
      organizationId,
      agentId,
      targets: targets.map((target) => ({
        id: this.deps.newId(),
        label: labelOfTarget(target),
        target,
      })),
    });
    return {
      agentId,
      targets: stored.map(({ id, label, target }) => ({ id, label, target })),
      updatedAt: stored[0]?.updatedAt ?? null,
    };
  }

  private async planOf({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopPlan> {
    const stored = await this.deps.plans.findTargets({ organizationId, agentId });
    return {
      agentId,
      targets: stored.map(({ id, label, target }) => ({ id, label, target })),
      updatedAt: stored[0]?.updatedAt ?? null,
    };
  }

  private async validate({
    organizationId,
    targets,
  }: {
    organizationId: string;
    targets: readonly AgentStopTarget[];
  }): Promise<void> {
    const connectionIds = targets.flatMap((target) =>
      target.kind === "bedrock_agent_alias" ? [target.awsConnectionId] : [],
    );
    const connections = new Set(
      connectionIds.length === 0
        ? []
        : (await this.deps.awsConnections.findByIds({ organizationId, ids: connectionIds })).map(
            (connection) => connection.id,
          ),
    );
    for (const [position, target] of targets.entries()) {
      const reason = await this.refusalOf({ organizationId, target, connections });
      if (reason) throw new AgentStopTargetInvalidError({ position, kind: target.kind, reason });
    }
  }

  private async refusalOf({
    organizationId,
    target,
    connections,
  }: {
    organizationId: string;
    target: AgentStopTarget;
    connections: ReadonlySet<string>;
  }): Promise<string | undefined> {
    switch (target.kind) {
      case "databricks_serving_endpoint": {
        const source = await this.deps.sources.findById(target.ingestionSourceId);
        if (!source || source.organizationId !== organizationId || source.archivedAt) {
          return "source_not_found";
        }
        return source.sourceType === DATABRICKS_GENIE_ADAPTER_ID
          ? undefined
          : "source_not_databricks";
      }
      case "bedrock_agent_alias":
        return connections.has(target.awsConnectionId) ? undefined : "aws_connection_not_found";
      case "gateway_virtual_key": {
        const key = await this.deps.virtualKeys.findVirtualKeyById(
          target.virtualKeyId,
          organizationId,
        );
        return key ? undefined : "virtual_key_not_found";
      }
    }
  }
}
