// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentStopCaller,
  type AgentStopDecidedEventData,
  AgentStopNotPendingError,
  AgentStopNotRestorableError,
  AgentStopNotRetryableError,
  AgentStopPlanChangedError,
  type AgentStopPlanTarget,
  type AgentStopRestoreRequestedEventData,
  type AgentStopRetryRequestedEventData,
  AgentStopSelfApprovalError,
  type AgentStopTargetsDroppedEventData,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";

import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { KillSwitchLockRepository } from "../../../repositories/kill-switch-lock.repository.ts";
import { targetKeyOf } from "../rules/agent-stop-target.rules.ts";
import {
  advancedStop,
  type AgentStopRecord,
  approvedStop,
  deniedStop,
  isOpenStatus,
  isRequester,
  isRestorableStatus,
  isRetryableStatus,
  isSamePlan,
  restoreRequestedStop,
  retriedStop,
  targetsDroppedStop,
  viewOfStop,
} from "../rules/agent-stop.rules.ts";
import type { AgentStopClaimService } from "./agent-stop-claim.service.ts";
import type { AgentStopPlanService } from "./agent-stop-plan.service.ts";
import type { AgentStopRequestAuditService } from "./agent-stop-request-audit.service.ts";
import type { AgentStopCommandSend } from "./agent-stop.service.ts";

/**
 * One agent's plan edits and its stop's lifecycle requests (request, restore, retry, drop) take
 * turns on this key, so each decides on the row the one before it advanced.
 */
export function agentLockKey({
  organizationId,
  agentId,
}: {
  organizationId: string;
  agentId: string;
}): string {
  return `agent-stop-plan:${organizationId}:${agentId}`;
}

interface AgentStopLifecycleDependencies {
  stops: Pick<AgentStopRepository, "getStop" | "getStopWithCursor" | "findByAgent" | "advance">;
  plans: Pick<AgentStopPlanService, "findTargets">;
  claims: Pick<AgentStopClaimService, "withDecision">;
  locks: KillSwitchLockRepository;
  audit: Pick<AgentStopRequestAuditService, "record">;
  send: AgentStopCommandSend;
  newId: () => string;
  now: () => number;
}

/**
 * What an open stop accepts after its request: a decision, a restore, a retry, and the targets a
 * plan edit drops. Each decides on the stop's row read under its agent's lock, by the fold's own rule.
 */
export class AgentStopLifecycleService {
  private constructor(private readonly deps: AgentStopLifecycleDependencies) {}

  static create(deps: AgentStopLifecycleDependencies): AgentStopLifecycleService {
    return new AgentStopLifecycleService(deps);
  }

  /**
   * An approval or denial, decided and advanced as a restore is, under the agent's lock, so one
   * landing after a plan edit closed the stop is refused `agent_stop_not_pending`, not answered.
   */
  decide(input: {
    organizationId: string;
    stopId: string;
    note?: string;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
    approve: boolean;
  }): Promise<AgentStopView> {
    return this.withStopLock({ ...input, run: (read) => this.decideLocked({ ...input, read }) });
  }

  private async decideLocked({
    organizationId,
    stopId,
    note,
    expectedTargetIds,
    caller,
    approve,
    read,
  }: {
    organizationId: string;
    stopId: string;
    note?: string;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
    approve: boolean;
    read: { stop: AgentStopRecord; eventId: string };
  }): Promise<AgentStopView> {
    const current = read.stop;
    if (current.status !== "pending_approval") {
      throw new AgentStopNotPendingError({ stopId, status: current.status });
    }
    if (approve && isRequester({ caller, stop: current })) {
      throw new AgentStopSelfApprovalError(stopId);
    }
    const stopTargetIds = current.targets.map((target) => target.id);
    if (expectedTargetIds && !isSamePlan(stopTargetIds, expectedTargetIds)) {
      throw new AgentStopPlanChangedError(current.agentId);
    }
    const requestId = this.deps.newId();
    const data: AgentStopDecidedEventData = {
      stopId,
      organizationId,
      decidedByUserId: caller.userId,
      decidedByApiKeyId: caller.apiKeyId,
      note: note ?? null,
      requestId,
    };
    const at = this.deps.now();
    await this.deps.claims.withDecision({
      organizationId,
      stopId,
      status: current.status,
      decision: approve ? "approve" : "deny",
      at,
      send: () =>
        this.deps.send(approve ? "approve" : "deny", {
          tenantId: organizationId,
          occurredAt: at,
          ...data,
        }),
    });
    const stop = (approve ? approvedStop : deniedStop)({ stop: current, data, at });
    await this.advance({ stop, requestId, eventId: read.eventId });
    await this.deps.audit.record({
      action: approve ? "governance.agent.stop_approved" : "governance.agent.stop_denied",
      stop,
      caller,
      note,
      occurredAt: at,
    });
    return viewOfStop(stop);
  }

  /**
   * Decided by the fold's own rule on the row, under the agent's lock: the request is sent only when
   * the stop accepts it, and the row is advanced to what it accepted, so the next request reads it.
   */
  restore(input: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.withStopLock({ ...input, run: (read) => this.restoreLocked({ ...input, read }) });
  }

  private async restoreLocked({
    organizationId,
    stopId,
    caller,
    read,
  }: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
    read: { stop: AgentStopRecord; eventId: string };
  }): Promise<AgentStopView> {
    const current = read.stop;
    if (!isRestorableStatus(current.status)) {
      throw new AgentStopNotRestorableError({ stopId, status: current.status });
    }
    const data: AgentStopRestoreRequestedEventData = {
      stopId,
      organizationId,
      requestedByUserId: caller.userId,
      requestedByApiKeyId: caller.apiKeyId,
      requestId: this.deps.newId(),
    };
    const at = this.deps.now();
    await this.deps.send("requestRestore", { tenantId: organizationId, occurredAt: at, ...data });
    const stop = restoreRequestedStop({ stop: current, data, at });
    await this.advance({ stop, requestId: data.requestId, eventId: read.eventId });
    await this.deps.audit.record({
      action: "governance.agent.restore_requested",
      stop,
      caller,
      occurredAt: at,
    });
    return viewOfStop(stop);
  }

  /** Decided and advanced as a restore is, under the agent's lock. */
  retryStop(input: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.withStopLock({ ...input, run: (read) => this.retryStopLocked({ ...input, read }) });
  }

  private async retryStopLocked({
    organizationId,
    stopId,
    caller,
    read,
  }: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
    read: { stop: AgentStopRecord; eventId: string };
  }): Promise<AgentStopView> {
    const current = read.stop;
    if (!isRetryableStatus(current.status)) {
      throw new AgentStopNotRetryableError({ stopId, status: current.status });
    }
    const plan = await this.deps.plans.findTargets({
      organizationId,
      agentId: current.agentId,
    });
    const held = new Set(current.targets.map((outcome) => targetKeyOf(outcome.target)));
    const data: AgentStopRetryRequestedEventData = {
      stopId,
      organizationId,
      requestedByUserId: caller.userId,
      requestedByApiKeyId: caller.apiKeyId,
      requestId: this.deps.newId(),
      targets: plan.filter((target) => !held.has(targetKeyOf(target.target))),
    };
    const at = this.deps.now();
    await this.deps.send("retry", { tenantId: organizationId, occurredAt: at, ...data });
    const stop = retriedStop({ stop: current, data, at });
    await this.advance({ stop, requestId: data.requestId, eventId: read.eventId });
    await this.deps.audit.record({
      action: "governance.agent.stop_retried",
      stop,
      caller,
      occurredAt: at,
    });
    return viewOfStop(stop);
  }

  /**
   * After the agent's plan changed: the open stop lets go of every target the plan no longer
   * holds, so a deleted resource taken out of the plan stops holding the stop or its restore.
   */
  async dropRemovedTargets({
    organizationId,
    agentId,
    plan,
  }: {
    organizationId: string;
    agentId: string;
    plan: readonly AgentStopPlanTarget[];
  }): Promise<void> {
    const [found] = await this.deps.stops.findByAgent({ organizationId, agentId, limit: 1 });
    if (!found || !isOpenStatus(found.status)) return;
    const read = await this.deps.stops.getStopWithCursor({ organizationId, stopId: found.id });
    const kept = new Set(plan.map((target) => targetKeyOf(target.target)));
    const targetIds = read.stop.targets
      .filter((outcome) => !kept.has(targetKeyOf(outcome.target)))
      .map((outcome) => outcome.id);
    if (targetIds.length === 0) return;
    const data: AgentStopTargetsDroppedEventData = {
      stopId: read.stop.id,
      organizationId,
      targetIds,
      dropId: this.deps.newId(),
    };
    const at = this.deps.now();
    await this.deps.send("dropTargets", { tenantId: organizationId, occurredAt: at, ...data });
    const stop = targetsDroppedStop({ stop: read.stop, data, at });
    if (stop !== read.stop) {
      await this.advance({ stop, requestId: data.dropId, eventId: read.eventId });
    }
  }

  /**
   * Writes the request's outcome to the row read at `eventId`, ahead of the worker, marking the
   * request so the projection folds its event as a no-op instead of applying it a second time.
   */
  private advance({
    stop,
    requestId,
    eventId,
  }: {
    stop: AgentStopRecord;
    requestId: string;
    eventId: string;
  }): Promise<void> {
    return this.deps.stops.advance({ stop: advancedStop({ stop, requestId }), eventId });
  }

  /** Runs `run` on the stop's row as read under its agent's lock, with the cursor it was read at. */
  private async withStopLock<T>({
    organizationId,
    stopId,
    run,
  }: {
    organizationId: string;
    stopId: string;
    run: (read: { stop: AgentStopRecord; eventId: string }) => Promise<T>;
  }): Promise<T> {
    const { agentId } = await this.deps.stops.getStop({ organizationId, stopId });
    return this.deps.locks.withLock({
      key: agentLockKey({ organizationId, agentId }),
      run: async () => run(await this.deps.stops.getStopWithCursor({ organizationId, stopId })),
    });
  }
}
