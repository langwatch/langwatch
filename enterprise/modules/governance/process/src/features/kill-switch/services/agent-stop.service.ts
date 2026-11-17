// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_STOP_OPEN_STATUSES,
  type AgentKillSwitchSummary,
  type AgentStopCaller,
  type AgentStopDecidedEventData,
  AgentStopNotFoundError,
  type AgentStopPage,
  AgentStopNotPendingError,
  AgentStopPlanChangedError,
  AgentStopPlanEmptyError,
  type AgentStopRequestedEventData,
  AgentStopSelfApprovalError,
  type AgentStopSeverity,
  type AgentStopStatus,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { ValidationError } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type {
  AgentRegistryRepository,
  RegistryEntryPosition,
} from "../../../repositories/agent-registry.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { KillSwitchLockRepository } from "../../../repositories/kill-switch-lock.repository.ts";
import type { AgentStopCommandName } from "../eventing/agent-stop.commands.ts";
import {
  type AgentStopRecord,
  approvalOf,
  approvedStop,
  decodeStopCursor,
  deniedStop,
  encodeStopCursor,
  inventoryRowIdsOf,
  requestedStop,
  viewOfStop,
} from "../rules/agent-stop.rules.ts";
import type { AgentStopClaimService } from "./agent-stop-claim.service.ts";
import { AgentStopLifecycleService, agentLockKey } from "./agent-stop-lifecycle.service.ts";
import type { AgentStopPlanService } from "./agent-stop-plan.service.ts";
import { AgentStopRequestAuditService } from "./agent-stop-request-audit.service.ts";
import type { KillSwitchAuditService } from "./kill-switch-audit.service.ts";

/** Sends one `agent_stop` command; the payload is the event data with tenant and moment merged in. */
export type AgentStopCommandSend = (
  name: AgentStopCommandName,
  payload: { tenantId: string; occurredAt: number } & Record<string, unknown>,
) => Promise<void>;

const READ_LIMIT = 200;

/** True when the plan holds exactly the target ids the caller confirmed. */
function isSamePlan(targetIds: readonly string[], expected: readonly string[]): boolean {
  const held = new Set(targetIds);
  return held.size === new Set(expected).size && expected.every((id) => held.has(id));
}

/** A send refused by name or by its payload's schema never reached the queue. */
function isRefusedBeforeSend(error: unknown): boolean {
  return HandledError.isHandled(error) || error instanceof ValidationError;
}

/** The requesting key, or the person behind it (the key's owner, or another key they own). */
function isRequester({
  caller,
  stop,
}: {
  caller: AgentStopCaller;
  stop: AgentStopRecord;
}): boolean {
  if (caller.apiKeyId && caller.apiKeyId === stop.requestedByApiKeyId) return true;
  return caller.userId !== null && caller.userId === stop.requestedByUserId;
}

interface AgentStopDependencies {
  requestAudit: AgentStopRequestAuditService;
  stops: Pick<
    AgentStopRepository,
    | "getStop"
    | "getStopWithCursor"
    | "findByAgent"
    | "findByStatuses"
    | "findAllByStatuses"
    | "seed"
    | "advance"
  >;
  claims: Pick<AgentStopClaimService, "claim" | "markSent" | "release" | "withDecision">;
  plans: Pick<AgentStopPlanService, "findTargets" | "findPlanCounts" | "setPlan">;
  locks: KillSwitchLockRepository;
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
  private readonly lifecycle: AgentStopLifecycleService;

  private constructor(private readonly deps: AgentStopDependencies) {
    this.lifecycle = AgentStopLifecycleService.create({ ...deps, audit: deps.requestAudit });
  }

  /** The request trail and the lifecycle are collaborators, built from the same dependencies. */
  static create({
    newId = () => generate("agentstop").toString(),
    now = () => nowInstant().epochMilliseconds,
    pageSize = READ_LIMIT,
    ...deps
  }: Omit<AgentStopDependencies, "newId" | "now" | "pageSize" | "requestAudit"> & {
    newId?: () => string;
    now?: () => number;
    pageSize?: number;
  }): AgentStopService {
    const requestAudit = AgentStopRequestAuditService.create({ audit: deps.audit });
    return new AgentStopService({ ...deps, requestAudit, newId, now, pageSize });
  }

  requestStop(input: {
    organizationId: string;
    agentId: string;
    reason: string;
    severity: AgentStopSeverity;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.deps.requestAudit.recordingRefusal({
      action: "governance.agent.stop_requested",
      ...input,
      run: () => this.requestStopOnce(input),
    });
  }

  /** Under the agent's lock, so a plan edit cannot drop a target between the plan read and the seed. */
  private requestStopOnce(input: {
    organizationId: string;
    agentId: string;
    reason: string;
    severity: AgentStopSeverity;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.deps.locks.withLock({
      key: agentLockKey(input),
      run: () => this.requestStopLocked(input),
    });
  }

  private async requestStopLocked({
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
      // An unclear failure may have landed: the claim stays until the stop shows up or is abandoned.
      if (isRefusedBeforeSend(error)) {
        await this.deps.claims.release({ organizationId, agentId, stopId });
      }
      throw error;
    }
    const stop = requestedStop({ data, at });
    await Promise.all([
      this.deps.stops.seed({ stop, at }),
      this.deps.claims.markSent({ organizationId, agentId, stopId, sentAt: this.deps.now() }),
      this.deps.requestAudit.record({ action: "governance.agent.stop_requested", stop, caller }),
    ]);
    return viewOfStop(stop);
  }

  /** Refused `agent_stop_plan_changed` when `expectedTargetIds` no longer names the stop's targets. */
  approveStop(input: {
    organizationId: string;
    stopId: string;
    note?: string;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.deps.requestAudit.recordingRefusal({
      action: "governance.agent.stop_approved",
      ...input,
      run: () => this.decide({ ...input, approve: true }),
    });
  }

  denyStop(input: {
    organizationId: string;
    stopId: string;
    note?: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.deps.requestAudit.recordingRefusal({
      action: "governance.agent.stop_denied",
      ...input,
      run: () => this.decide({ ...input, approve: false }),
    });
  }

  restore(input: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.deps.requestAudit.recordingRefusal({
      action: "governance.agent.restore_requested",
      ...input,
      run: () => this.lifecycle.restore(input),
    });
  }

  /**
   * Applies again what the stop has not stopped: the targets it failed to stop or a restore turned
   * back on, and the plan targets added since. Refused `agent_stop_not_retryable` unless the stop
   * is quarantined, stop_failed or restore_failed.
   */
  retryStop(input: {
    organizationId: string;
    stopId: string;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    return this.deps.requestAudit.recordingRefusal({
      action: "governance.agent.stop_retried",
      ...input,
      run: () => this.lifecycle.retryStop(input),
    });
  }

  /** Saves the plan and lets the open stop go of removed targets, one plan edit per agent at a time. */
  async setPlan(
    input: Parameters<AgentStopPlanService["setPlan"]>[0],
  ): ReturnType<AgentStopPlanService["setPlan"]> {
    return this.deps.locks.withLock({
      key: agentLockKey(input),
      run: async () => {
        const plan = await this.deps.plans.setPlan(input);
        await this.lifecycle.dropRemovedTargets({
          organizationId: input.organizationId,
          agentId: input.agentId,
          plan: plan.targets,
        });
        return plan;
      },
    });
  }

  /** After the agent's plan changed, the open stop lets go of what the plan no longer holds. */
  dropRemovedTargets(
    input: Parameters<AgentStopLifecycleService["dropRemovedTargets"]>[0],
  ): Promise<void> {
    return this.lifecycle.dropRemovedTargets(input);
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
    expectedTargetIds,
    caller,
    approve,
  }: {
    organizationId: string;
    stopId: string;
    note?: string;
    expectedTargetIds?: readonly string[];
    caller: AgentStopCaller;
    approve: boolean;
  }): Promise<AgentStopView> {
    const current = await this.deps.stops.getStop({ organizationId, stopId });
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
    await this.deps.requestAudit.record({
      action: approve ? "governance.agent.stop_approved" : "governance.agent.stop_denied",
      stop,
      caller,
      note,
    });
    return viewOfStop(stop);
  }
}
