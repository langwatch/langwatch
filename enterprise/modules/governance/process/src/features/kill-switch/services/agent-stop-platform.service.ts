// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_STOP_OPEN_STATUSES,
  AGENT_STOP_STATUSES,
  type AgentStopTarget,
  type AgentStopTargetOutcome,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { type Instant, Temporal } from "@langwatch/time";

import type { BedrockAgentAliasChannel } from "../../../channels/bedrock-agent-alias.channel.ts";
import type { DatabricksServingEndpointChannel } from "../../../channels/databricks-serving-endpoint.channel.ts";
import { KillSwitchPlatformError } from "../../../channels/kill-switch-platform.channel.ts";
import type { ProviderSignInChannel } from "../../../channels/provider-sign-in.channel.ts";
import type { AgentStopTargetPriorStateRepository } from "../../../repositories/agent-stop-target-prior-state.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { GovernanceAwsConnectionRepository } from "../../../repositories/governance-aws-connection.repository.ts";
import type { KillSwitchLockRepository } from "../../../repositories/kill-switch-lock.repository.ts";
import type { SourceCredentialAccessService } from "../../ingestion-source/services/source-credential-access.service.ts";
import type { AgentStopApplyIntent } from "../eventing/agent-stop.process.ts";
import {
  BEDROCK_INVOCATION_STATES,
  isSameBedrockAlias,
  workspaceKeyOf,
} from "../rules/agent-stop-target.rules.ts";

export type Direction = "stop" | "restore";

export interface AgentStopPlatformDependencies {
  sourceCredentials: Pick<SourceCredentialAccessService, "withSourceCredentials">;
  signIn: Pick<ProviderSignInChannel, "getWorkspaceToken">;
  servingEndpoints: DatabricksServingEndpointChannel;
  awsConnections: Pick<GovernanceAwsConnectionRepository, "getCredentials">;
  bedrock: BedrockAgentAliasChannel;
  priorStates: AgentStopTargetPriorStateRepository;
  virtualKeys: Pick<GatewayApi, "findVirtualKeyById" | "disableVirtualKey" | "enableVirtualKey">;
  stops: Pick<AgentStopRepository, "findAllByStatuses">;
  locks: KillSwitchLockRepository;
  now: () => number;
}

const AGENT_STOP_CLOSED_STATUSES = AGENT_STOP_STATUSES.filter(
  (status) => !AGENT_STOP_OPEN_STATUSES.includes(status),
);

/**
 * Applied, or an apply that may already have run. A stop being restored, or whose restore failed,
 * is letting the target go, so two restores of stops sharing one never both keep it stopped.
 */
function isHolding(outcome: AgentStopTargetOutcome): boolean {
  return outcome.state === "applied" || outcome.state === "pending";
}

/** Being restored, or its restore failed: a later restore of that stop may still turn it on. */
function isReleasing(outcome: AgentStopTargetOutcome): boolean {
  return outcome.state === "reverting" || outcome.state === "revert_failed";
}

/** What every platform call reads off its intent, an apply or a revert. */
export type AgentStopTargetWork = Omit<AgentStopApplyIntent, "retryRound">;

/** A call's outcome: whether it changed the platform, and whether a shared target was left stopped. */
type CallOutcome = { changed: boolean; keptDisabled?: boolean };

/** Whether another stop's target names the resource a call acts on. */
type SameResource = (other: AgentStopTarget) => boolean | Promise<boolean>;

type ServingEndpointCall = { workspaceUrl: string; token: string; endpointName: string };

/**
 * The platform calls of a stop's targets: a Databricks serving endpoint, a Bedrock alias or a
 * gateway virtual key, stopped or restored. Each is written under a lock of its own resource, and
 * a shared one stays stopped on restore while another open stop holds it.
 */
export class AgentStopPlatformService {
  private constructor(private readonly deps: AgentStopPlatformDependencies) {}

  static create(deps: AgentStopPlatformDependencies): AgentStopPlatformService {
    return new AgentStopPlatformService(deps);
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
    intent: AgentStopTargetWork;
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

  /** The holder check and the key write run under one lock per key, so shared-key work never interleaves. */
  private async callVirtualKey(input: {
    intent: AgentStopTargetWork;
    virtualKeyId: string;
    direction: Direction;
  }): Promise<CallOutcome> {
    return this.deps.locks.withLock({
      key: `virtual-key:${input.intent.organizationId}:${input.virtualKeyId}`,
      run: ({ signal }) => this.callVirtualKeyLocked({ ...input, signal }),
    });
  }

  /** `signal` aborts before the lock can lapse, so no key write lands after another holder took it. */
  private async callVirtualKeyLocked({
    intent,
    virtualKeyId,
    direction,
    signal,
  }: {
    intent: AgentStopTargetWork;
    virtualKeyId: string;
    direction: Direction;
    signal: AbortSignal;
  }): Promise<CallOutcome> {
    const { organizationId } = intent;
    const command = { id: virtualKeyId, organizationId, actorUserId: intent.actorUserId };
    const isSame: SameResource = (other) =>
      other.kind === "gateway_virtual_key" && other.virtualKeyId === virtualKeyId;
    if (direction === "restore") {
      if (await this.isHeldByAnotherStop({ intent, isSame })) {
        return { changed: false, keptDisabled: true };
      }
      signal.throwIfAborted();
      await this.deps.virtualKeys.enableVirtualKey(command);
      return { changed: true };
    }
    return this.stopUnlessAlreadyStopped({
      intent,
      // A key another stop holds or may still enable, or a closed stop left disabled, is this stop's too.
      isStopped: async () => {
        const key = await this.deps.virtualKeys.findVirtualKeyById(virtualKeyId, organizationId);
        if (key === null || key.status === "ACTIVE") return false;
        return !(await this.isLeftOffByAnotherStop({ intent, isSame, disabledAt: key.disabledAt }));
      },
      stop: () => {
        signal.throwIfAborted();
        return this.deps.virtualKeys.disableVirtualKey({
          ...command,
          reason: `kill switch stop ${intent.stopId}: ${intent.reason}`,
        });
      },
    });
  }

  /**
   * An alias another open stop holds stays rejecting on restore, and a stop that finds it left off
   * by another stop counts it as its own change, so the last restore accepts invocations again.
   */
  private async callBedrock({
    intent,
    target,
    direction,
  }: {
    intent: AgentStopTargetWork;
    target: Extract<AgentStopTarget, { kind: "bedrock_agent_alias" }>;
    direction: Direction;
  }): Promise<CallOutcome> {
    const alias = {
      credentials: await this.deps.awsConnections.getCredentials({
        organizationId: intent.organizationId,
        id: target.awsConnectionId,
      }),
      region: target.region,
      agentId: target.agentId,
      agentAliasId: target.agentAliasId,
    };
    const isSame: SameResource = (other) => isSameBedrockAlias({ target, other });
    const { region, agentId, agentAliasId } = target;
    return this.deps.locks.withLock({
      key: `bedrock-alias:${intent.organizationId}:${region}:${agentId}:${agentAliasId}`,
      run: async ({ signal }) => {
        if (direction === "restore") {
          if (await this.isHeldByAnotherStop({ intent, isSame })) {
            return { changed: false, keptDisabled: true };
          }
          signal.throwIfAborted();
          await this.deps.bedrock.setInvocationState({
            ...alias,
            state: BEDROCK_INVOCATION_STATES.restore,
          });
          return { changed: true };
        }
        return this.stopUnlessAlreadyStopped({
          intent,
          isStopped: async () =>
            (await this.deps.bedrock.getInvocationState(alias)) ===
              BEDROCK_INVOCATION_STATES.stop &&
            !(await this.isLeftOffByAnotherStop({ intent, isSame })),
          stop: () => {
            signal.throwIfAborted();
            return this.deps.bedrock.setInvocationState({
              ...alias,
              state: BEDROCK_INVOCATION_STATES.stop,
            });
          },
        });
      },
    });
  }

  /**
   * An endpoint another open stop holds stays stopped on restore. A stop always calls stop and
   * counts the endpoint as its own change, since the channel cannot read whether it was stopped.
   */
  private async callServingEndpointLocked({
    intent,
    target,
    call,
    direction,
    signal,
  }: {
    intent: AgentStopTargetWork;
    target: Extract<AgentStopTarget, { kind: "databricks_serving_endpoint" }>;
    call: ServingEndpointCall;
    direction: Direction;
    signal: AbortSignal;
  }): Promise<CallOutcome> {
    const { organizationId } = intent;
    if (direction === "restore") {
      const workspace = workspaceKeyOf(call.workspaceUrl);
      const workspaces = new Map<string, Promise<string | null>>();
      const isSame: SameResource = async (other) => {
        if (other.kind !== "databricks_serving_endpoint") return false;
        if (other.endpointName !== target.endpointName) return false;
        if (other.ingestionSourceId === target.ingestionSourceId) return true;
        const known = workspaces.get(other.ingestionSourceId);
        const found =
          known ?? this.workspaceOf({ organizationId, ingestionSourceId: other.ingestionSourceId });
        workspaces.set(other.ingestionSourceId, found);
        return (await found) === workspace;
      };
      if (await this.isHeldByAnotherStop({ intent, isSame })) {
        return { changed: false, keptDisabled: true };
      }
      signal.throwIfAborted();
      await this.deps.servingEndpoints.startEndpoint(call);
      return { changed: true };
    }
    signal.throwIfAborted();
    await this.deps.servingEndpoints.stopEndpoint(call);
    // Marks the endpoint as this stop's, so a later 404 on it reads as deleted, not wrong.
    await this.deps.priorStates.recordOnce({
      organizationId,
      stopId: intent.stopId,
      targetId: intent.target.id,
      wasStopped: false,
      recordedAt: this.deps.now(),
    });
    return { changed: true };
  }

  /** The workspace a Databricks source names, or null for a source gone or not configured. */
  private async workspaceOf({
    organizationId,
    ingestionSourceId,
  }: {
    organizationId: string;
    ingestionSourceId: string;
  }): Promise<string | null> {
    try {
      return await this.deps.sourceCredentials.withSourceCredentials({
        organizationId,
        ingestionSourceId,
        use: async ({ config }) => {
          const parsed = databricksGeniePullConfigSchema.safeParse(config);
          return parsed.success ? workspaceKeyOf(parsed.data.workspaceUrl) : null;
        },
      });
    } catch (error) {
      if (HandledError.isHandled(error)) return null;
      throw error;
    }
  }

  /**
   * Another open stop holds the resource once its apply ran: it recorded the resource as not
   * stopped before stopping it, and the target is applied or its apply is in flight. A stop
   * waiting for approval holds nothing. `includeReleasing` also counts one letting it go.
   */
  private async isHeldByAnotherStop({
    intent,
    isSame,
    includeReleasing = false,
  }: {
    intent: AgentStopTargetWork;
    isSame: SameResource;
    includeReleasing?: boolean;
  }): Promise<boolean> {
    const open = await this.deps.stops.findAllByStatuses({
      organizationId: intent.organizationId,
      statuses: AGENT_STOP_OPEN_STATUSES,
    });
    for (const stop of open) {
      if (stop.id === intent.stopId) continue;
      for (const outcome of stop.targets) {
        const counts = isHolding(outcome) || (includeReleasing && isReleasing(outcome));
        if (!counts || !(await isSame(outcome.target))) continue;
        const [wasStopped] = await this.deps.priorStates.findPriorStates({
          organizationId: intent.organizationId,
          stopId: stop.id,
          targetId: outcome.id,
        });
        if (wasStopped === false) return true;
      }
    }
    return false;
  }

  /**
   * Off because of another stop, so a new stop must count it as its own change: another open stop
   * holds it, or is letting it go and may still turn it on (reverting, or its revert failed), or a
   * closed stop's restore kept it off for a holder that let it go.
   */
  private async isLeftOffByAnotherStop(input: {
    intent: AgentStopTargetWork;
    isSame: SameResource;
    disabledAt?: Instant | null;
  }): Promise<boolean> {
    return (
      (await this.isHeldByAnotherStop({ ...input, includeReleasing: true })) ||
      (await this.isKeptDisabledByClosedStop(input))
    );
  }

  /**
   * A closed stop's restore kept this target off for a holder that let it go, so nobody owns it
   * now. A key disabled after that restore was disabled by someone else and stays theirs; an alias
   * answers no such moment (`disabledAt` undefined), so any kept-off alias counts.
   */
  private async isKeptDisabledByClosedStop({
    intent,
    isSame,
    disabledAt,
  }: {
    intent: AgentStopTargetWork;
    isSame: SameResource;
    disabledAt?: Instant | null;
  }): Promise<boolean> {
    if (disabledAt === null) return false;
    const closed = await this.deps.stops.findAllByStatuses({
      organizationId: intent.organizationId,
      statuses: AGENT_STOP_CLOSED_STATUSES,
    });
    for (const stop of closed) {
      for (const outcome of stop.targets) {
        if (outcome.keptDisabled !== true || outcome.revertedAt === null) continue;
        if (!(await isSame(outcome.target))) continue;
        const revertedAt = Temporal.Instant.from(outcome.revertedAt);
        if (disabledAt === undefined || Temporal.Instant.compare(disabledAt, revertedAt) <= 0) {
          return true;
        }
      }
    }
    return false;
  }

  /** One platform call for the intent's target, in `direction`. */
  async call({
    intent,
    target,
    direction,
  }: {
    intent: AgentStopTargetWork;
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
            return this.deps.locks.withLock({
              key: `serving-endpoint:${organizationId}:${workspaceKeyOf(workspaceUrl)}:${target.endpointName}`,
              run: ({ signal }) =>
                this.callServingEndpointLocked({ intent, target, call, direction, signal }),
            });
          },
        });
      case "bedrock_agent_alias":
        return this.callBedrock({ intent, target, direction });
      case "gateway_virtual_key":
        return this.callVirtualKey({ intent, virtualKeyId: target.virtualKeyId, direction });
    }
  }
}
