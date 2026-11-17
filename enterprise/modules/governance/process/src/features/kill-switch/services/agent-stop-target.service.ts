// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  type AgentStopTarget,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { IntentContext } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { BedrockAgentAliasChannel } from "../../../channels/bedrock-agent-alias.channel.ts";
import {
  type DatabricksServingEndpointChannel,
  KillSwitchPlatformError,
} from "../../../channels/databricks-serving-endpoint.channel.ts";
import type { ProviderSignInChannel } from "../../../channels/provider-sign-in.channel.ts";
import type { AgentStopTargetPriorStateRepository } from "../../../repositories/agent-stop-target-prior-state.repository.ts";
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
  priorStates: AgentStopTargetPriorStateRepository;
  virtualKeys: Pick<GatewayApi, "findVirtualKeyById" | "disableVirtualKey" | "enableVirtualKey">;
  registry: Pick<AgentRegistryService, "announceStop">;
  auditLog: Pick<AuditLogApi, "record">;
  maxAttempts: number;
  now: () => number;
  logger: Logger;
}

type Direction = "stop" | "restore";

/**
 * The worker's half of a stop: one platform call per intent, then the outcome recorded as a
 * command. A failing call is thrown back to the outbox until `maxAttempts`; later attempts record
 * the target failed instead, and only a failing record is retried, within the outbox's own budget.
 * Whether a target was stopped before the stop is recorded once, before the first call.
 */
export class AgentStopTargetService implements AgentStopIntentExecutors {
  private constructor(private readonly deps: AgentStopTargetDependencies) {}

  static create({
    maxAttempts = AGENT_STOP_MAX_ATTEMPTS,
    now = () => nowInstant().epochMilliseconds,
    logger = createLogger("langwatch:governance:kill-switch"),
    ...deps
  }: Omit<AgentStopTargetDependencies, "maxAttempts" | "now" | "logger"> & {
    maxAttempts?: number;
    now?: () => number;
    logger?: Logger;
  }): AgentStopTargetService {
    return new AgentStopTargetService({ ...deps, maxAttempts, now, logger });
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
      const errorCode = errorCodeOf(error);
      this.deps.logger.warn(
        {
          error,
          errorCode,
          direction,
          stopId: intent.stopId,
          targetId: intent.target.id,
          organizationId: intent.organizationId,
        },
        "kill switch target call failed on its last attempt; recording the target failed",
      );
      return { ok: false, changed: false, errorCode };
    }
  }

  /**
   * Stops a key or alias unless it was already stopped before this stop first touched it. The
   * prior state is read and recorded once, so a retry after a successful call (live state now
   * stopped) still counts the change as the stop's own and the restore reverts it.
   */
  private async stopUnlessAlreadyStopped({
    intent,
    isStopped,
    stop,
  }: {
    intent: AgentStopApplyIntent;
    isStopped: () => Promise<boolean>;
    stop: () => Promise<unknown>;
  }): Promise<{ changed: boolean }> {
    const key = {
      organizationId: intent.organizationId,
      stopId: intent.stopId,
      targetId: intent.target.id,
    };
    const [recorded] = await this.deps.priorStates.findPriorStates(key);
    const wasStopped =
      recorded ??
      (await this.deps.priorStates.recordOnce({
        ...key,
        wasStopped: await isStopped(),
        recordedAt: this.deps.now(),
      }));
    if (wasStopped) return { changed: false };
    await stop();
    return { changed: true };
  }

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
    return this.stopUnlessAlreadyStopped({
      intent,
      isStopped: async () => {
        const key = await this.deps.virtualKeys.findVirtualKeyById(virtualKeyId, organizationId);
        return key !== null && key.status !== "ACTIVE";
      },
      stop: () =>
        this.deps.virtualKeys.disableVirtualKey({
          ...command,
          reason: `kill switch stop ${intent.stopId}: ${intent.reason}`,
        }),
    });
  }

  private async callBedrock({
    intent,
    target,
    direction,
  }: {
    intent: AgentStopApplyIntent;
    target: Extract<AgentStopTarget, { kind: "bedrock_agent_alias" }>;
    direction: Direction;
  }): Promise<{ changed: boolean }> {
    const alias = {
      credentials: await this.deps.awsConnections.getCredentials({
        organizationId: intent.organizationId,
        id: target.awsConnectionId,
      }),
      region: target.region,
      agentId: target.agentId,
      agentAliasId: target.agentAliasId,
    };
    if (direction === "restore") {
      await this.deps.bedrock.setInvocationState({
        ...alias,
        state: BEDROCK_INVOCATION_STATES.restore,
      });
      return { changed: true };
    }
    return this.stopUnlessAlreadyStopped({
      intent,
      isStopped: async () =>
        (await this.deps.bedrock.getInvocationState(alias)) === BEDROCK_INVOCATION_STATES.stop,
      stop: () =>
        this.deps.bedrock.setInvocationState({ ...alias, state: BEDROCK_INVOCATION_STATES.stop }),
    });
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
      case "bedrock_agent_alias":
        return this.callBedrock({ intent, target, direction });
      case "gateway_virtual_key":
        return this.callVirtualKey({ intent, virtualKeyId: target.virtualKeyId, direction });
    }
  }
}
