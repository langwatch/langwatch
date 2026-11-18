// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentStopPlan,
  type AgentStopPlanTarget,
  AgentStopPlanConflictError,
  type AgentStopTarget,
  AgentStopTargetInvalidError,
  AgentStopTargetNotFoundError,
  DATABRICKS_GENIE_ADAPTER_ID,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { generate } from "@langwatch/ksuid";

import type { BedrockAgentAliasChannel } from "../../../channels/bedrock-agent-alias.channel.ts";
import type { DatabricksServingEndpointChannel } from "../../../channels/databricks-serving-endpoint.channel.ts";
import type { ProviderSignInChannel } from "../../../channels/provider-sign-in.channel.ts";
import type { AgentRegistryRepository } from "../../../repositories/agent-registry.repository.ts";
import type {
  AgentStopPlanCount,
  AgentStopPlanRepository,
  StoredAgentStopPlan,
} from "../../../repositories/agent-stop-plan.repository.ts";
import type { GovernanceAwsConnectionRepository } from "../../../repositories/governance-aws-connection.repository.ts";
import type { IngestionSourceRepository } from "../../../repositories/ingestion-source.repository.ts";
import type { SourceCredentialAccessService } from "../../ingestion-source/services/source-credential-access.service.ts";
import { errorCodeOf, isGoneErrorCode } from "../rules/agent-stop-target.rules.ts";
import { labelOfTarget } from "../rules/agent-stop.rules.ts";

function viewOfPlan({
  agentId,
  plan,
}: {
  agentId: string;
  plan: StoredAgentStopPlan;
}): AgentStopPlan {
  return {
    agentId,
    targets: plan.targets.map(({ id, label, target }) => ({ id, label, target })),
    updatedAt: plan.updatedAt,
    version: plan.version,
  };
}

/** One plan save: the full target list, and optionally the version the caller last read. */
export interface AgentStopPlanInput {
  organizationId: string;
  agentId: string;
  targets: readonly AgentStopTarget[];
  expectedVersion?: number;
}

interface AgentStopPlanDependencies {
  plans: AgentStopPlanRepository;
  registry: Pick<AgentRegistryRepository, "getEntry">;
  sources: Pick<IngestionSourceRepository, "findById">;
  awsConnections: Pick<GovernanceAwsConnectionRepository, "findByIds" | "getCredentials">;
  virtualKeys: Pick<GatewayApi, "findVirtualKeyById">;
  sourceCredentials: Pick<SourceCredentialAccessService, "withSourceCredentials">;
  signIn: Pick<ProviderSignInChannel, "getWorkspaceToken">;
  servingEndpoints: Pick<DatabricksServingEndpointChannel, "checkEndpoint">;
  bedrock: Pick<BedrockAgentAliasChannel, "getInvocationState">;
  newId: () => string;
}

/**
 * Each registry agent's stop plan. A write names only what the organisation holds: its own
 * Databricks sources, AWS connections and gateway virtual keys, else it is refused by position;
 * a serving endpoint or Bedrock alias its platform answers not found is refused the same way.
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
    return viewOfPlan({
      agentId,
      plan: await this.deps.plans.getPlan({ organizationId, agentId }),
    });
  }

  /** The plan's targets without the registry check, for a stop that has already read the entry. */
  async findTargets({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopPlanTarget[]> {
    const stored = await this.deps.plans.findTargets({ organizationId, agentId });
    return stored.map(({ id, label, target }) => ({ id, label, target }));
  }

  findPlanCounts({ organizationId }: { organizationId: string }): Promise<AgentStopPlanCount[]> {
    return this.deps.plans.findPlanCounts({ organizationId });
  }

  /** Refused `agent_stop_plan_conflict` when `expectedVersion` is given and the plan moved past it. */
  async setPlan(input: AgentStopPlanInput): Promise<AgentStopPlan> {
    await this.checkPlan(input);
    return this.savePlan(input);
  }

  /**
   * The slow half of a save: the registry entry and every target's platform. A caller holding the
   * agent's lock runs it before taking the lock, so no platform call holds it.
   */
  async checkPlan({ organizationId, agentId, targets }: AgentStopPlanInput): Promise<void> {
    await this.deps.registry.getEntry({ organizationId, id: agentId });
    await this.checkOnPlatform({ organizationId, targets });
  }

  /** Database work only: ownership is checked again and `expectedVersion` refuses a moved plan. */
  async savePlan({
    organizationId,
    agentId,
    targets,
    expectedVersion,
  }: AgentStopPlanInput): Promise<AgentStopPlan> {
    await this.deps.registry.getEntry({ organizationId, id: agentId });
    const replaced = await this.deps.plans.replaceTargets({
      organizationId,
      agentId,
      targets: targets.map((target) => ({
        id: this.deps.newId(),
        label: labelOfTarget(target),
        target,
      })),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      // Under the connections lock, so a connection deleted meanwhile is refused here.
      whileLocked: () => this.validate({ organizationId, targets }),
    });
    if (replaced.outcome === "conflict") {
      throw new AgentStopPlanConflictError({
        agentId,
        expectedVersion: expectedVersion ?? replaced.version,
        version: replaced.version,
      });
    }
    return viewOfPlan({ agentId, plan: replaced.plan });
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

  /** Before any lock, so no platform call holds one; an unowned target is refused under the lock. */
  private async checkOnPlatform({
    organizationId,
    targets,
  }: {
    organizationId: string;
    targets: readonly AgentStopTarget[];
  }): Promise<void> {
    for (const [position, target] of targets.entries()) {
      if (await this.isMissingOnPlatform({ organizationId, target })) {
        throw new AgentStopTargetNotFoundError({ position, kind: target.kind });
      }
    }
  }

  /**
   * True only when the platform answers not found. Any other failure lets the save through, so an
   * outage never blocks a plan edit; the stop's first call reports it on the target.
   */
  private async isMissingOnPlatform({
    organizationId,
    target,
  }: {
    organizationId: string;
    target: AgentStopTarget;
  }): Promise<boolean> {
    try {
      await this.probe({ organizationId, target });
      return false;
    } catch (error) {
      return isGoneErrorCode(errorCodeOf(error));
    }
  }

  private async probe({
    organizationId,
    target,
  }: {
    organizationId: string;
    target: AgentStopTarget;
  }): Promise<void> {
    switch (target.kind) {
      case "databricks_serving_endpoint":
        return this.deps.sourceCredentials.withSourceCredentials({
          organizationId,
          ingestionSourceId: target.ingestionSourceId,
          use: async (context) => {
            const config = databricksGeniePullConfigSchema.safeParse(context.config);
            if (!config.success) return;
            const { workspaceUrl } = config.data;
            const token = await this.deps.signIn.getWorkspaceToken({
              credentials: context.credentials,
              workspaceUrl,
            });
            await this.deps.servingEndpoints.checkEndpoint({
              workspaceUrl,
              token,
              endpointName: target.endpointName,
            });
          },
        });
      case "bedrock_agent_alias":
        await this.deps.bedrock.getInvocationState({
          credentials: await this.deps.awsConnections.getCredentials({
            organizationId,
            id: target.awsConnectionId,
          }),
          region: target.region,
          agentId: target.agentId,
          agentAliasId: target.agentAliasId,
        });
        return;
      case "gateway_virtual_key":
        return;
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
