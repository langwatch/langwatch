// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  AGENT_STOP_OPEN_STATUSES,
  type AgentStopTarget,
  type AgentStopView,
  type AgentStopWebhookEventType,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { IntentContext } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";

import type { BedrockAgentAliasChannel } from "../../../channels/bedrock-agent-alias.channel.ts";
import type { DatabricksServingEndpointChannel } from "../../../channels/databricks-serving-endpoint.channel.ts";
import { KillSwitchPlatformError } from "../../../channels/kill-switch-platform.channel.ts";
import type { ProviderSignInChannel } from "../../../channels/provider-sign-in.channel.ts";
import type { AgentStopTargetPriorStateRepository } from "../../../repositories/agent-stop-target-prior-state.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
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
import {
  BEDROCK_INVOCATION_STATES,
  errorCodeOf,
  isGoneErrorCode,
} from "../rules/agent-stop-target.rules.ts";
import { AGENT_STOP_AUDIT_TARGET_KIND, type AgentStopCommandSend } from "./agent-stop.service.ts";

/** The audit log takes an `audit` KSUID as a key, and reads the row's moment from it. */
const AUDIT_KEY_RESOURCE = "audit";

/**
 * The audit key of one announced milestone: derived from the stop, milestone and restore round, so
 * a redelivered announcement names one row. Its moment is the stop's latest recorded time.
 */
export function milestoneAuditKeyOf({
  stop,
  milestone,
  restoreRound,
}: {
  stop: AgentStopView;
  milestone: AgentStopWebhookEventType;
  restoreRound: number;
}): string {
  const digest = createHash("sha256")
    .update(`${stop.id}\u001f${milestone}\u001f${restoreRound}`)
    .digest();
  const moments = [
    stop.requestedAt,
    stop.decidedAt,
    stop.quarantinedAt,
    stop.restoreRequestedAt,
    stop.restoredAt,
  ].flatMap((at) => (at ? [Temporal.Instant.from(at).epochMilliseconds] : []));
  return new Ksuid({
    environment: getEnvironment(),
    resource: AUDIT_KEY_RESOURCE,
    timestamp: Math.floor(Math.max(...moments) / 1000),
    instance: new Instance(Instance.schemes.RANDOM, new Uint8Array(digest.subarray(0, 8))),
    sequenceId: digest.readUInt32BE(8) >>> 1,
  }).toString();
}

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
  stops: Pick<AgentStopRepository, "findAllByStatuses">;
  auditLog: Pick<AuditLogApi, "record">;
  maxAttempts: number;
  now: () => number;
  logger: Logger;
}

type Direction = "stop" | "restore";

/** A call's outcome: whether it changed the platform, and whether a shared key was left disabled. */
type CallOutcome = { changed: boolean; keptDisabled?: boolean };

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
      ...(outcome.gone ? { gone: true } : {}),
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
      ...(outcome.gone ? { gone: true } : {}),
      ...(outcome.keptDisabled ? { keptDisabled: true } : {}),
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
      idempotencyKey: milestoneAuditKeyOf({ stop, milestone, restoreRound }),
      organizationId,
      action: milestone,
      targetKind: AGENT_STOP_AUDIT_TARGET_KIND,
      targetId: stop.agentId,
      metadata: {
        targetName: stop.agentName,
        stopId: stop.id,
        agentName: stop.agentName,
        status: stop.status,
        restoreRound,
        targets: stop.targets.map((target) => ({
          id: target.id,
          label: target.label,
          state: target.state,
          errorCode: target.errorCode,
          ...(target.gone ? { gone: true } : {}),
          ...(target.keptDisabled ? { keptDisabled: true } : {}),
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
  }): Promise<{
    ok: boolean;
    changed: boolean;
    gone: boolean;
    keptDisabled?: boolean;
    errorCode: string | null;
  }> {
    try {
      const { changed, keptDisabled } = await this.call({
        intent,
        target: intent.target.target,
        direction,
      });
      return {
        ok: true,
        changed,
        gone: false,
        errorCode: null,
        ...(keptDisabled ? { keptDisabled } : {}),
      };
    } catch (error) {
      const errorCode = errorCodeOf(error);
      if (isGoneErrorCode(errorCode))
        return { ok: true, changed: false, gone: true, errorCode: null };
      if (context.attempt < this.deps.maxAttempts) throw error;
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
      return { ok: false, changed: false, gone: false, errorCode };
    }
  }

  /**
   * Stops a key or alias unless it was already stopped before this stop first touched it. The
   * prior state is recorded once, so a retry after a successful call still counts the change as
   * the stop's own; a retry that finds it stopped does not call the platform again, so a later
   * platform refusal cannot turn an applied change into a failure the restore would skip.
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
    if (recorded === undefined) {
      const wasStopped = await this.deps.priorStates.recordOnce({
        ...key,
        wasStopped: await isStopped(),
        recordedAt: this.deps.now(),
      });
      if (wasStopped) return { changed: false };
      await stop();
      return { changed: true };
    }
    if (recorded) return { changed: false };
    if (!(await isStopped())) await stop();
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
  }): Promise<CallOutcome> {
    const { organizationId } = intent;
    const command = { id: virtualKeyId, organizationId, actorUserId: intent.actorUserId };
    if (direction === "restore") {
      if (await this.isKeyHeldByAnotherStop({ intent, virtualKeyId })) {
        return { changed: false, keptDisabled: true };
      }
      await this.deps.virtualKeys.enableVirtualKey(command);
      return { changed: true };
    }
    return this.stopUnlessAlreadyStopped({
      intent,
      // A key another of our stops disabled counts as this stop's change too, so the last restore enables it.
      isStopped: async () => {
        const key = await this.deps.virtualKeys.findVirtualKeyById(virtualKeyId, organizationId);
        if (key === null || key.status === "ACTIVE") return false;
        return !(await this.isKeyHeldByAnotherStop({ intent, virtualKeyId }));
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

  /** True while another agent's open stop holds the same key stopped (or is about to stop it). */
  private async isKeyHeldByAnotherStop({
    intent,
    virtualKeyId,
  }: {
    intent: AgentStopApplyIntent;
    virtualKeyId: string;
  }): Promise<boolean> {
    const open = await this.deps.stops.findAllByStatuses({
      organizationId: intent.organizationId,
      statuses: AGENT_STOP_OPEN_STATUSES,
    });
    return open.some(
      (stop) =>
        stop.id !== intent.stopId &&
        stop.targets.some(
          (outcome) =>
            outcome.target.kind === "gateway_virtual_key" &&
            outcome.target.virtualKeyId === virtualKeyId &&
            (outcome.state === "applied" || outcome.state === "pending"),
        ),
    );
  }

  private async call({
    intent,
    target,
    direction,
  }: {
    intent: AgentStopApplyIntent;
    target: AgentStopTarget;
    direction: Direction;
  }): Promise<CallOutcome> {
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
