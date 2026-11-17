// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_STOP_OPEN_STATUSES,
  type AgentKillSwitchSummary,
  type AgentStopCaller,
  type AgentStopDecidedEventData,
  AgentStopNotFoundError,
  type AgentStopPage,
  AgentStopNotPendingError,
  AgentStopNotRestorableError,
  AgentStopNotRetryableError,
  type AgentStopPlanTarget,
  AgentStopPlanChangedError,
  AgentStopPlanEmptyError,
  type AgentStopRequestedEventData,
  type AgentStopRestoreRequestedEventData,
  type AgentStopRetryRequestedEventData,
  AgentStopSelfApprovalError,
  type AgentStopSeverity,
  type AgentStopStatus,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type {
  AgentRegistryRepository,
  RegistryEntryPosition,
} from "../../../repositories/agent-registry.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { AgentStopCommandName } from "../eventing/agent-stop.commands.ts";
import { targetKeyOf } from "../rules/agent-stop-target.rules.ts";
import {
  type AgentStopRecord,
  approvalOf,
  approvedStop,
  decodeStopCursor,
  deniedStop,
  encodeStopCursor,
  inventoryRowIdsOf,
  isOpenStatus,
  isRestorableStatus,
  isRetryableStatus,
  requestedStop,
  restoreRequestedStop,
  retriedStop,
  viewOfStop,
} from "../rules/agent-stop.rules.ts";
import type { AgentStopClaimService } from "./agent-stop-claim.service.ts";
import type { AgentStopPlanService } from "./agent-stop-plan.service.ts";
import type { KillSwitchAuditService } from "./kill-switch-audit.service.ts";

/** Sends one `agent_stop` command; the payload is the event data with tenant and moment merged in. */
export type AgentStopCommandSend = (
  name: AgentStopCommandName,
  payload: { tenantId: string; occurredAt: number } & Record<string, unknown>,
) => Promise<void>;

/** The audit rows' target kind: the stop is about the registry agent. */
export const AGENT_STOP_AUDIT_TARGET_KIND = "governance_agent";

const READ_LIMIT = 200;

/** True when the plan holds exactly the target ids the caller confirmed. */
function isSamePlan(targetIds: readonly string[], expected: readonly string[]): boolean {
  const held = new Set(targetIds);
  return held.size === new Set(expected).size && expected.every((id) => held.has(id));
}

interface AgentStopDependencies {
  stops: Pick<
    AgentStopRepository,
    "getStop" | "findByAgent" | "findByStatuses" | "findAllByStatuses" | "seed"
  >;
  claims: Pick<AgentStopClaimService, "claim" | "markSent" | "release" | "withDecision">;
  plans: Pick<AgentStopPlanService, "findTargets" | "findPlanCounts">;
  registry: Pick<AgentRegistryRepository, "getEntry" | "listEntries" | "findSourceKeys">;
  audit: Pick<KillSwitchAuditService, "record">;
  send: AgentStopCommandSend;
  newId: () => string;
  now: () => number;
  pageSize: number;
}

/**
 * Requests, decides and restores an agent's stop. Each is one command on the stop's own aggregate;
 * the worker's process manager does the platform calls. A person's stop and a critical machine
 * stop act at once, any other waits for an approval by another credential.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export class AgentStopService {
  private constructor(private readonly deps: AgentStopDependencies) {}

  static create({
    newId = () => generate("agentstop").toString(),
    now = () => nowInstant().epochMilliseconds,
    pageSize = READ_LIMIT,
    ...deps
  }: Omit<AgentStopDependencies, "newId" | "now" | "pageSize"> & {
    newId?: () => string;
    now?: () => number;
    pageSize?: number;
  }): AgentStopService {
    return new AgentStopService({ ...deps, newId, now, pageSize });
  }

  async requestStop({
    organizationId,
    agentId,
    reason,
    severity,
    expectedTargetIds,
    caller,
  }: {
    organizationId: string;
    agentId: string;
    reason: string;
    severity: AgentStopSeverity;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    const entry = await this.deps.registry.getEntry({ organizationId, id: agentId });
    const targets = await this.deps.plans.findTargets({ organizationId, agentId });
    if (targets.length === 0) throw new AgentStopPlanEmptyError(agentId);
    const targetIds = targets.map((target) => target.id);
    if (expectedTargetIds && !isSamePlan(targetIds, expectedTargetIds)) {
      throw new AgentStopPlanChangedError(agentId);
    }
    const stopId = this.deps.newId();
    const at = this.deps.now();
    await this.deps.claims.claim({ organizationId, agentId, stopId, at });

    const trigger = caller.apiKeyId ? "api_key" : "user";
    const data: AgentStopRequestedEventData = {
      stopId,
      organizationId,
      agentId,
      agentName: entry.name,
      severity,
      approval: approvalOf({ trigger, severity }),
      trigger,
      reason,
      requestedByUserId: caller.userId,
      requestedByApiKeyId: caller.apiKeyId,
      targets,
    };
    try {
      await this.deps.send("request", { tenantId: organizationId, occurredAt: at, ...data });
    } catch (error) {
      await this.deps.claims.release({ organizationId, agentId, stopId });
      throw error;
    }
    const stop = requestedStop({ data, at });
    await Promise.all([
      this.deps.stops.seed({ stop, at }),
      this.deps.claims.markSent({ organizationId, agentId, stopId, sentAt: this.deps.now() }),
      this.audit({ action: "governance.agent.stop_requested", stop, caller }),
    ]);
    return viewOfStop(stop);
  }

  approveStop(input: {
    organizationId: string;
    stopId: string;
    note?: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.decide({ ...input, approve: true });
  }

  denyStop(input: {
    organizationId: string;
    stopId: string;
    note?: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.decide({ ...input, approve: false });
  }

  async restore({
    organizationId,
    stopId,
    caller,
  }: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    const current = await this.deps.stops.getStop({ organizationId, stopId });
    if (!isRestorableStatus(current.status)) {
      throw new AgentStopNotRestorableError({ stopId, status: current.status });
    }
    const data: AgentStopRestoreRequestedEventData = {
      stopId,
      organizationId,
      requestedByUserId: caller.userId,
      requestedByApiKeyId: caller.apiKeyId,
      restoreRound: current.restoreRound + 1,
    };
    const at = this.deps.now();
    await this.deps.send("requestRestore", { tenantId: organizationId, occurredAt: at, ...data });
    const stop = restoreRequestedStop({ stop: current, data, at });
    await this.audit({ action: "governance.agent.restore_requested", stop, caller });
    return viewOfStop(stop);
  }

  /**
   * Applies again what the stop has not stopped: the targets it failed to stop or a restore turned
   * back on, and the plan targets added since. Refused `agent_stop_not_retryable` unless the stop
   * is quarantined, stop_failed or restore_failed.
   */
  async retryStop({
    organizationId,
    stopId,
    caller,
  }: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    const current = await this.deps.stops.getStop({ organizationId, stopId });
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
      retryRound: current.retryRound + 1,
      targets: plan.filter((target) => !held.has(targetKeyOf(target.target))),
    };
    const at = this.deps.now();
    await this.deps.send("retry", { tenantId: organizationId, occurredAt: at, ...data });
    const stop = retriedStop({ stop: current, data, at });
    await this.audit({ action: "governance.agent.stop_retried", stop, caller });
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
    const [latest] = await this.deps.stops.findByAgent({ organizationId, agentId, limit: 1 });
    if (!latest || !isOpenStatus(latest.status)) return;
    const kept = new Set(plan.map((target) => targetKeyOf(target.target)));
    const targetIds = latest.targets
      .filter((outcome) => !kept.has(targetKeyOf(outcome.target)))
      .map((outcome) => outcome.id);
    if (targetIds.length === 0) return;
    await this.deps.send("dropTargets", {
      tenantId: organizationId,
      occurredAt: this.deps.now(),
      stopId: latest.id,
      organizationId,
      targetIds,
      dropId: this.deps.newId(),
    });
  }

  /** The agent's latest stop; refused `agent_stop_not_found` when it was never stopped. */
  async getLatestStop({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopView> {
    await this.deps.registry.getEntry({ organizationId, id: agentId });
    const [latest] = await this.deps.stops.findByAgent({ organizationId, agentId, limit: 1 });
    if (!latest) throw new AgentStopNotFoundError(agentId);
    return viewOfStop(latest);
  }

  /** One page of stops, latest request first; `next_cursor` is null on the last page. */
  async listStops({
    organizationId,
    statuses,
    limit,
    cursor,
  }: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
    cursor?: string;
  }): Promise<AgentStopPage> {
    const read = await this.deps.stops.findByStatuses({
      organizationId,
      ...(statuses && statuses.length > 0 ? { statuses } : {}),
      limit: limit + 1,
      ...(cursor ? { before: decodeStopCursor(cursor) } : {}),
    });
    const page = read.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(viewOfStop),
      next_cursor: read.length > limit && last ? encodeStopCursor(last) : null,
    };
  }

  /** Every stop waiting for a decision, paged to the end. */
  async findPendingApprovals({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentStopView[]> {
    const pending = await this.deps.stops.findAllByStatuses({
      organizationId,
      statuses: ["pending_approval"],
      pageSize: this.deps.pageSize,
    });
    return pending.map(viewOfStop);
  }

  /**
   * One row per active registry agent, plus any other agent holding a plan or an open stop, keyed
   * to its Agents-page row. An agent with no plan yet still gets a row, so its first plan can be set.
   * The Agents page lists every agent, so both reads are paged to the end.
   */
  async findSummaries({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentKillSwitchSummary[]> {
    const [counts, open, activeIds] = await Promise.all([
      this.deps.plans.findPlanCounts({ organizationId }),
      this.deps.stops.findAllByStatuses({
        organizationId,
        statuses: AGENT_STOP_OPEN_STATUSES,
        pageSize: this.deps.pageSize,
      }),
      this.findAllActiveAgentIds({ organizationId }),
    ]);
    const openByAgent = new Map<string, AgentStopRecord>();
    for (const stop of open)
      if (!openByAgent.has(stop.agentId)) openByAgent.set(stop.agentId, stop);
    const countByAgent = new Map(counts.map((count) => [count.agentId, count.targetCount]));
    const agentIds = [...new Set([...activeIds, ...countByAgent.keys(), ...openByAgent.keys()])];
    if (agentIds.length === 0) return [];
    const sourceKeys = new Map(
      (await this.deps.registry.findSourceKeys({ organizationId, ids: agentIds })).map((row) => [
        row.id,
        row.sourceKey,
      ]),
    );
    return agentIds.map((agentId) => {
      const sourceKey = sourceKeys.get(agentId);
      const openStop = openByAgent.get(agentId);
      return {
        agentId,
        inventoryRowId: sourceKey ? (inventoryRowIdsOf(sourceKey)[0] ?? null) : null,
        planTargetCount: countByAgent.get(agentId) ?? 0,
        openStop: openStop ? viewOfStop(openStop) : null,
      };
    });
  }

  private async findAllActiveAgentIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const ids: string[] = [];
    let after: RegistryEntryPosition | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await this.deps.registry.listEntries({
        organizationId,
        status: "active",
        limit: this.deps.pageSize,
        ...(after ? { after } : {}),
      });
      ids.push(...page.entries.map((entry) => entry.id));
      const last = page.entries.at(-1);
      hasMore = page.hasMore && last !== undefined;
      if (last) after = { updatedAt: last.updated_at, id: last.id };
    }
    return ids;
  }

  private async decide({
    organizationId,
    stopId,
    note,
    caller,
    approve,
  }: {
    organizationId: string;
    stopId: string;
    note?: string;
    caller: AgentStopCaller;
    approve: boolean;
  }): Promise<AgentStopView> {
    const current = await this.deps.stops.getStop({ organizationId, stopId });
    if (current.status !== "pending_approval") {
      throw new AgentStopNotPendingError({ stopId, status: current.status });
    }
    if (approve && caller.apiKeyId && caller.apiKeyId === current.requestedByApiKeyId) {
      throw new AgentStopSelfApprovalError(stopId);
    }
    const data: AgentStopDecidedEventData = {
      stopId,
      organizationId,
      decidedByUserId: caller.userId,
      decidedByApiKeyId: caller.apiKeyId,
      note: note ?? null,
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
    const stop = approve
      ? approvedStop({ stop: current, data, at })
      : deniedStop({ stop: current, data, at });
    await this.audit({
      action: approve ? "governance.agent.stop_approved" : "governance.agent.stop_denied",
      stop,
      caller,
      note,
    });
    return viewOfStop(stop);
  }

  private async audit({
    action,
    stop,
    caller,
    note,
  }: {
    action: string;
    stop: AgentStopRecord;
    caller: AgentStopCaller;
    note?: string;
  }): Promise<void> {
    // A service key has no user: the row names the key, as the door's own audit rows do.
    const actor = caller.userId ?? (caller.apiKeyId ? `apikey:${caller.apiKeyId}` : null);
    await this.deps.audit.record({
      ...(actor ? { userId: actor } : {}),
      organizationId: stop.organizationId,
      action,
      targetKind: AGENT_STOP_AUDIT_TARGET_KIND,
      targetId: stop.agentId,
      metadata: {
        targetName: stop.agentName,
        stopId: stop.id,
        agentName: stop.agentName,
        status: stop.status,
        severity: stop.severity,
        approval: stop.approval,
        trigger: stop.trigger,
        reason: stop.reason,
        apiKeyId: caller.apiKeyId,
        ...(note ? { note } : {}),
      },
    });
  }
}
