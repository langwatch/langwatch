// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  AGENT_STOP_OPEN_STATUSES,
  type AgentKillSwitchSummary,
  AgentStopAlreadyOpenError,
  type AgentStopDecidedEventData,
  AgentStopNotFoundError,
  AgentStopNotPendingError,
  AgentStopNotRestorableError,
  AgentStopPlanEmptyError,
  type AgentStopRequestedEventData,
  type AgentStopRestoreRequestedEventData,
  AgentStopSelfApprovalError,
  type AgentStopSeverity,
  type AgentStopStatus,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type { AgentRegistryRepository } from "../../../repositories/agent-registry.repository.ts";
import type { AgentStopClaimRepository } from "../../../repositories/agent-stop-claim.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { AgentStopCommandName } from "../eventing/agent-stop.commands.ts";
import {
  type AgentStopRecord,
  approvalOf,
  approvedStop,
  deniedStop,
  inventoryRowIdsOf,
  isOpenStatus,
  isRestorableStatus,
  requestedStop,
  restoreRequestedStop,
  viewOfStop,
} from "../rules/agent-stop.rules.ts";
import type { AgentStopPlanService } from "./agent-stop-plan.service.ts";

/** Who asked: a person (userId only) or an organisation API key (its id, and its owner if any). */
export type AgentStopCaller = { userId: string | null; apiKeyId: string | null };

/** Sends one `agent_stop` command; the payload is the event data with tenant and moment merged in. */
export type AgentStopCommandSend = (
  name: AgentStopCommandName,
  payload: { tenantId: string; occurredAt: number } & Record<string, unknown>,
) => Promise<void>;

/** The audit rows' target kind: the stop is about the registry agent. */
export const AGENT_STOP_AUDIT_TARGET_KIND = "governance_agent";

const READ_LIMIT = 200;

/** A claim whose stop never reached the projection this long after it was taken is abandoned. */
const ABANDONED_CLAIM_MS = 15 * 60 * 1000;

interface AgentStopDependencies {
  stops: Pick<AgentStopRepository, "getStop" | "findByAgent" | "findByStatuses">;
  claims: AgentStopClaimRepository;
  plans: Pick<AgentStopPlanService, "findTargets" | "findPlanCounts">;
  registry: Pick<AgentRegistryRepository, "getEntry" | "findSourceKeys">;
  auditLog: Pick<AuditLogApi, "record">;
  send: AgentStopCommandSend;
  newId: () => string;
  now: () => number;
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
    ...deps
  }: Omit<AgentStopDependencies, "newId" | "now"> & {
    newId?: () => string;
    now?: () => number;
  }): AgentStopService {
    return new AgentStopService({ ...deps, newId, now });
  }

  async requestStop({
    organizationId,
    agentId,
    reason,
    severity,
    caller,
  }: {
    organizationId: string;
    agentId: string;
    reason: string;
    severity: AgentStopSeverity;
    caller: AgentStopCaller;
  }): Promise<AgentStopView> {
    const entry = await this.deps.registry.getEntry({ organizationId, id: agentId });
    const targets = await this.deps.plans.findTargets({ organizationId, agentId });
    if (targets.length === 0) throw new AgentStopPlanEmptyError(agentId);
    const stopId = this.deps.newId();
    const at = this.deps.now();
    await this.claimAgent({ organizationId, agentId, stopId, at });

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
    await this.audit({ action: "governance.agent.stop_requested", stop, caller });
    return viewOfStop(stop);
  }

  /**
   * Takes the agent's one open-stop claim, or refuses `agent_stop_already_open`. A claim passes to
   * the new stop only once the stop holding it has closed, or never reached the projection.
   */
  private async claimAgent({
    organizationId,
    agentId,
    stopId,
    at,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
    at: number;
  }): Promise<void> {
    const claim = { organizationId, agentId, claimedAt: at };
    if (await this.deps.claims.create({ ...claim, stopId })) return;
    const [held] = await this.deps.claims.findClaims({ organizationId, agentId });
    if (!held) {
      if (await this.deps.claims.create({ ...claim, stopId })) return;
      throw new AgentStopAlreadyOpenError({ agentId, stopId: "unknown" });
    }
    if (!(await this.isClaimReleased({ organizationId, held, at }))) {
      throw new AgentStopAlreadyOpenError({ agentId, stopId: held.stopId });
    }
    const swapped = await this.deps.claims.swap({
      ...claim,
      fromStopId: held.stopId,
      toStopId: stopId,
    });
    if (!swapped) throw new AgentStopAlreadyOpenError({ agentId, stopId: held.stopId });
  }

  private async isClaimReleased({
    organizationId,
    held,
    at,
  }: {
    organizationId: string;
    held: { stopId: string; claimedAt: number };
    at: number;
  }): Promise<boolean> {
    try {
      const stop = await this.deps.stops.getStop({ organizationId, stopId: held.stopId });
      return !isOpenStatus(stop.status);
    } catch (error) {
      if (!(error instanceof AgentStopNotFoundError)) throw error;
      return at - held.claimedAt > ABANDONED_CLAIM_MS;
    }
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

  async findStops({
    organizationId,
    statuses,
  }: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
  }): Promise<AgentStopView[]> {
    const stops = await this.deps.stops.findByStatuses({
      organizationId,
      ...(statuses && statuses.length > 0 ? { statuses } : {}),
      limit: READ_LIMIT,
    });
    return stops.map(viewOfStop);
  }

  findPendingApprovals({ organizationId }: { organizationId: string }): Promise<AgentStopView[]> {
    return this.findStops({ organizationId, statuses: ["pending_approval"] });
  }

  /** One row per agent that holds a plan or an open stop, keyed to its Agents-page row. */
  async findSummaries({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentKillSwitchSummary[]> {
    const [counts, open] = await Promise.all([
      this.deps.plans.findPlanCounts({ organizationId }),
      this.deps.stops.findByStatuses({
        organizationId,
        statuses: AGENT_STOP_OPEN_STATUSES,
        limit: READ_LIMIT,
      }),
    ]);
    const openByAgent = new Map<string, AgentStopRecord>();
    for (const stop of open)
      if (!openByAgent.has(stop.agentId)) openByAgent.set(stop.agentId, stop);
    const countByAgent = new Map(counts.map((count) => [count.agentId, count.targetCount]));
    const agentIds = [...new Set([...countByAgent.keys(), ...openByAgent.keys()])];
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
    await this.deps.send(approve ? "approve" : "deny", {
      tenantId: organizationId,
      occurredAt: at,
      ...data,
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
    await this.deps.auditLog.record({
      ...(caller.userId ? { userId: caller.userId } : {}),
      organizationId: stop.organizationId,
      action,
      targetKind: AGENT_STOP_AUDIT_TARGET_KIND,
      targetId: stop.agentId,
      metadata: {
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
