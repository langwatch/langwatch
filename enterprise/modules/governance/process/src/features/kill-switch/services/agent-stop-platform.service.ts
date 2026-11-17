// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_STOP_OPEN_STATUSES,
  AGENT_STOP_STATUSES,
  type AgentStopTarget,
  type AgentStopTargetOutcome,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
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
import { BEDROCK_INVOCATION_STATES } from "../rules/agent-stop-target.rules.ts";

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

function isOnKey({
  outcome,
  virtualKeyId,
}: {
  outcome: AgentStopTargetOutcome;
  virtualKeyId: string;
}): boolean {
  return (
    outcome.target.kind === "gateway_virtual_key" && outcome.target.virtualKeyId === virtualKeyId
  );
}

/**
 * Applied, or an apply that may already have run. A stop being restored, or whose restore failed,
 * is letting the key go, so two restores of stops sharing a key never both keep it disabled.
 */
function isHolding(outcome: AgentStopTargetOutcome): boolean {
  return outcome.state === "applied" || outcome.state === "pending";
}

/** What every platform call reads off its intent, an apply or a revert. */
export type AgentStopTargetWork = Omit<AgentStopApplyIntent, "retryRound">;

/** A call's outcome: whether it changed the platform, and whether a shared key was left disabled. */
type CallOutcome = { changed: boolean; keptDisabled?: boolean };

/**
 * The platform calls of a stop's targets: a Databricks serving endpoint, a Bedrock alias or a
 * gateway virtual key, stopped or restored. A shared virtual key is written under its own lock, and
 * stays disabled on restore while another open stop holds it.
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
    if (direction === "restore") {
      if (await this.isKeyHeldByAnotherStop({ intent, virtualKeyId })) {
        return { changed: false, keptDisabled: true };
      }
      signal.throwIfAborted();
      await this.deps.virtualKeys.enableVirtualKey(command);
      return { changed: true };
    }
    return this.stopUnlessAlreadyStopped({
      intent,
      // A key another stop holds, or a closed stop's restore left disabled, is this stop's change too.
      isStopped: async () => {
        const key = await this.deps.virtualKeys.findVirtualKeyById(virtualKeyId, organizationId);
        if (key === null || key.status === "ACTIVE") return false;
        if (await this.isKeyHeldByAnotherStop({ intent, virtualKeyId })) return false;
        return !(await this.isKeptDisabledByClosedStop({
          intent,
          virtualKeyId,
          disabledAt: key.disabledAt,
        }));
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

  private async callBedrock({
    intent,
    target,
    direction,
  }: {
    intent: AgentStopTargetWork;
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

  /**
   * Another open stop holds the key once its apply ran: it recorded the key as not stopped before
   * disabling it, and the target is applied or its apply is in flight. A stop waiting for approval
   * holds nothing.
   */
  private async isKeyHeldByAnotherStop({
    intent,
    virtualKeyId,
  }: {
    intent: AgentStopTargetWork;
    virtualKeyId: string;
  }): Promise<boolean> {
    const open = await this.deps.stops.findAllByStatuses({
      organizationId: intent.organizationId,
      statuses: AGENT_STOP_OPEN_STATUSES,
    });
    const candidates = open.flatMap((stop) =>
      stop.id === intent.stopId
        ? []
        : stop.targets
            .filter((outcome) => isOnKey({ outcome, virtualKeyId }) && isHolding(outcome))
            .map((outcome) => ({ stopId: stop.id, targetId: outcome.id })),
    );
    for (const candidate of candidates) {
      const [wasStopped] = await this.deps.priorStates.findPriorStates({
        organizationId: intent.organizationId,
        ...candidate,
      });
      if (wasStopped === false) return true;
    }
    return false;
  }

  /**
   * A closed stop's restore kept this disable for a holder that let it go, so nobody owns it now.
   * A key disabled after that restore was disabled by someone else and stays theirs.
   */
  private async isKeptDisabledByClosedStop({
    intent,
    virtualKeyId,
    disabledAt,
  }: {
    intent: AgentStopTargetWork;
    virtualKeyId: string;
    disabledAt: Instant | null;
  }): Promise<boolean> {
    if (disabledAt === null) return false;
    const closed = await this.deps.stops.findAllByStatuses({
      organizationId: intent.organizationId,
      statuses: AGENT_STOP_CLOSED_STATUSES,
    });
    return closed.some((stop) =>
      stop.targets.some(
        (outcome) =>
          isOnKey({ outcome, virtualKeyId }) &&
          outcome.keptDisabled === true &&
          outcome.revertedAt !== null &&
          Temporal.Instant.compare(disabledAt, Temporal.Instant.from(outcome.revertedAt)) <= 0,
      ),
    );
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
            if (direction === "restore") {
              await this.deps.servingEndpoints.startEndpoint(call);
              return { changed: true };
            }
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
          },
        });
      case "bedrock_agent_alias":
        return this.callBedrock({ intent, target, direction });
      case "gateway_virtual_key":
        return this.callVirtualKey({ intent, virtualKeyId: target.virtualKeyId, direction });
    }
  }
}
