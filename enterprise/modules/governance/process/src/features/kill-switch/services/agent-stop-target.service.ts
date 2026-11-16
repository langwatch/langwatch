// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  type AgentStopTarget,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { IntentContext } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { nowInstant } from "@langwatch/time";

import type { BedrockAgentAliasChannel } from "../../../channels/bedrock-agent-alias.channel.ts";
import {
  type DatabricksServingEndpointChannel,
  KillSwitchPlatformError,
} from "../../../channels/databricks-serving-endpoint.channel.ts";
import type { ProviderSignInChannel } from "../../../channels/provider-sign-in.channel.ts";
import type { GovernanceAwsConnectionRepository } from "../../../repositories/governance-aws-connection.repository.ts";
import type { SourceCredentialAccessService } from "../../ingestion-source/services/source-credential-access.service.ts";
import type { AgentRegistryService } from "../../registry/services/agent-registry.service.ts";
import {
  AGENT_STOP_MAX_ATTEMPTS,
  type AgentStopAnnounceIntent,
  type AgentStopApplyIntent,
  type AgentStopIntentExecutors,
  type AgentStopRevertIntent,
} from "../eventing/agent-stop.process.ts";
import { BEDROCK_INVOCATION_STATES, errorCodeOf } from "../rules/agent-stop-target.rules.ts";
import { AGENT_STOP_AUDIT_TARGET_KIND, type AgentStopCommandSend } from "./agent-stop.service.ts";

interface AgentStopTargetDependencies {
  send: AgentStopCommandSend;
  sourceCredentials: Pick<SourceCredentialAccessService, "withSourceCredentials">;
  signIn: Pick<ProviderSignInChannel, "getWorkspaceToken">;
  servingEndpoints: DatabricksServingEndpointChannel;
  awsConnections: Pick<GovernanceAwsConnectionRepository, "getCredentials">;
  bedrock: BedrockAgentAliasChannel;
  virtualKeys: Pick<GatewayApi, "findVirtualKeyById" | "disableVirtualKey" | "enableVirtualKey">;
  registry: Pick<AgentRegistryService, "announceStop">;
  auditLog: Pick<AuditLogApi, "record">;
  maxAttempts: number;
  now: () => number;
}

type Direction = "stop" | "restore";

/**
 * The worker's half of a stop: one platform call per intent, then the outcome recorded as a
 * command. A failing call is thrown back to the outbox until its last attempt, which records the
 * target failed with a stable error code instead. Every call here is idempotent on the platform.
 */
export class AgentStopTargetService implements AgentStopIntentExecutors {
  private constructor(private readonly deps: AgentStopTargetDependencies) {}

  static create({
    maxAttempts = AGENT_STOP_MAX_ATTEMPTS,
    now = () => nowInstant().epochMilliseconds,
    ...deps
  }: Omit<AgentStopTargetDependencies, "maxAttempts" | "now"> & {
    maxAttempts?: number;
    now?: () => number;
  }): AgentStopTargetService {
    return new AgentStopTargetService({ ...deps, maxAttempts, now });
  }

  async applyTarget(intent: AgentStopApplyIntent, context: IntentContext): Promise<void> {
    const outcome = await this.attempt({ intent, direction: "stop", context });
    const settled = {
      tenantId: intent.organizationId,
      occurredAt: this.deps.now(),
      stopId: intent.stopId,
      organizationId: intent.organizationId,
      targetId: intent.target.id,
      errorCode: outcome.errorCode,
      ...(outcome.ok && !outcome.changed ? { alreadyStopped: true } : {}),
    };
    await this.deps.send(outcome.ok ? "recordTargetApplied" : "recordTargetFailed", settled);
  }

  async revertTarget(intent: AgentStopRevertIntent, context: IntentContext): Promise<void> {
    const outcome = await this.attempt({ intent, direction: "restore", context });
    const settled = {
      tenantId: intent.organizationId,
      occurredAt: this.deps.now(),
      stopId: intent.stopId,
      organizationId: intent.organizationId,
      targetId: intent.target.id,
      errorCode: outcome.errorCode,
      restoreRound: intent.restoreRound,
    };
    await this.deps.send(outcome.ok ? "recordTargetReverted" : "recordTargetRevertFailed", settled);
  }

  /**
   * The registry feed (webhooks) first, then the audit row; both carry every target's outcome. The
   * request's own row was written by whoever asked, so a stop_requested milestone is pushed only.
   */
  async announce(intent: AgentStopAnnounceIntent): Promise<void> {
    const { organizationId, milestone, restoreRound, stop } = intent;
    await this.deps.registry.announceStop({
      organizationId,
      eventId: `${stop.id}_${milestone.replace("governance.agent.", "")}_${restoreRound}`,
      milestone,
      stop,
    });
    if (milestone === "governance.agent.stop_requested") return;
    await this.deps.auditLog.record({
      organizationId,
      action: milestone,
      targetKind: AGENT_STOP_AUDIT_TARGET_KIND,
      targetId: stop.agentId,
      metadata: {
        stopId: stop.id,
        agentName: stop.agentName,
        status: stop.status,
        restoreRound,
        targets: stop.targets.map((target) => ({
          id: target.id,
          label: target.label,
          state: target.state,
          errorCode: target.errorCode,
        })),
      },
    });
  }

  private async attempt({
    intent,
    direction,
    context,
  }: {
    intent: AgentStopApplyIntent;
    direction: Direction;
    context: IntentContext;
  }): Promise<{ ok: boolean; changed: boolean; errorCode: string | null }> {
    try {
      const { changed } = await this.call({ intent, target: intent.target.target, direction });
      return { ok: true, changed, errorCode: null };
    } catch (error) {
      if (context.attempt < this.deps.maxAttempts) throw error;
      return { ok: false, changed: false, errorCode: errorCodeOf(error) };
    }
  }

  /** A key that is not active when the stop arrives is left alone, so a restore leaves it too. */
  private async callVirtualKey({
    intent,
    virtualKeyId,
    direction,
  }: {
    intent: AgentStopApplyIntent;
    virtualKeyId: string;
    direction: Direction;
  }): Promise<{ changed: boolean }> {
    const { organizationId } = intent;
    const command = { id: virtualKeyId, organizationId, actorUserId: intent.actorUserId };
    if (direction === "restore") {
      await this.deps.virtualKeys.enableVirtualKey(command);
      return { changed: true };
    }
    const key = await this.deps.virtualKeys.findVirtualKeyById(virtualKeyId, organizationId);
    if (key && key.status !== "ACTIVE") return { changed: false };
    await this.deps.virtualKeys.disableVirtualKey({
      ...command,
      reason: `kill switch stop ${intent.stopId}: ${intent.reason}`,
    });
    return { changed: true };
  }

  private async call({
    intent,
    target,
    direction,
  }: {
    intent: AgentStopApplyIntent;
    target: AgentStopTarget;
    direction: Direction;
  }): Promise<{ changed: boolean }> {
    const { organizationId } = intent;
    switch (target.kind) {
      case "databricks_serving_endpoint":
        return this.deps.sourceCredentials.withSourceCredentials({
          organizationId,
          ingestionSourceId: target.ingestionSourceId,
          use: async (context) => {
            const config = databricksGeniePullConfigSchema.safeParse(context.config);
            if (!config.success) {
              throw new KillSwitchPlatformError({
                code: "source_not_configured",
                message: "The Databricks source holds no workspace URL",
              });
            }
            const { workspaceUrl } = config.data;
            const token = await this.deps.signIn.getWorkspaceToken({
              credentials: context.credentials,
              workspaceUrl,
            });
            const call = { workspaceUrl, token, endpointName: target.endpointName };
            if (direction === "stop") await this.deps.servingEndpoints.stopEndpoint(call);
            else await this.deps.servingEndpoints.startEndpoint(call);
            return { changed: true };
          },
        });
      case "bedrock_agent_alias": {
        const credentials = await this.deps.awsConnections.getCredentials({
          organizationId,
          id: target.awsConnectionId,
        });
        return this.deps.bedrock.setInvocationState({
          credentials,
          region: target.region,
          agentId: target.agentId,
          agentAliasId: target.agentAliasId,
          state: BEDROCK_INVOCATION_STATES[direction],
        });
      }
      case "gateway_virtual_key":
        return this.callVirtualKey({ intent, virtualKeyId: target.virtualKeyId, direction });
    }
  }
}
