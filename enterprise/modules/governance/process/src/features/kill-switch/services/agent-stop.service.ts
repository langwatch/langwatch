// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentKillSwitchSummary,
  type AgentStopCaller,
  type AgentStopPage,
  type AgentStopPlan,
  AgentStopPlanChangedError,
  AgentStopPlanEmptyError,
  type AgentStopRequestedEventData,
  type AgentStopSeverity,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { ValidationError } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type { AgentRegistryRepository } from "../../../repositories/agent-registry.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { KillSwitchLockRepository } from "../../../repositories/kill-switch-lock.repository.ts";
import type { AgentStopCommandName } from "../eventing/agent-stop.commands.ts";
import { approvalOf, isSamePlan, requestedStop, viewOfStop } from "../rules/agent-stop.rules.ts";
import type { AgentStopClaimService } from "./agent-stop-claim.service.ts";
import { AgentStopLifecycleService, agentLockKey } from "./agent-stop-lifecycle.service.ts";
import type { AgentStopPlanInput, AgentStopPlanService } from "./agent-stop-plan.service.ts";
import { AgentStopReadsService } from "./agent-stop-reads.service.ts";
import {
  AGENT_STOP_PLAN_SET_ACTION,
  type AgentStopAuditAgent,
  AgentStopRequestAuditService,
} from "./agent-stop-request-audit.service.ts";
import type { KillSwitchAuditService } from "./kill-switch-audit.service.ts";

/** Sends one `agent_stop` command; the payload is the event data with tenant and moment merged in. */
export type AgentStopCommandSend = (
  name: AgentStopCommandName,
  payload: { tenantId: string; occurredAt: number } & Record<string, unknown>,
) => Promise<void>;

const READ_LIMIT = 200;

/** A send refused by name or by its payload's schema never reached the queue. */
function isRefusedBeforeSend(error: unknown): boolean {
  return HandledError.isHandled(error) || error instanceof ValidationError;
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
  plans: Pick<AgentStopPlanService, "findTargets" | "findPlanCounts" | "checkPlan" | "savePlan">;
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
  private readonly reads: AgentStopReadsService;

  private constructor(private readonly deps: AgentStopDependencies) {
    this.lifecycle = AgentStopLifecycleService.create({ ...deps, audit: deps.requestAudit });
    this.reads = AgentStopReadsService.create(deps);
  }

  /** The request trail, the lifecycle and the reads are collaborators, built from the same dependencies. */
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
      agentOf: () => this.agentOfEntry(input),
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
      this.deps.requestAudit.record({
        action: "governance.agent.stop_requested",
        stop,
        caller,
        occurredAt: at,
      }),
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
      agentOf: () => this.agentOfStop(input),
      run: () => this.lifecycle.decide({ ...input, approve: true }),
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
      agentOf: () => this.agentOfStop(input),
      run: () => this.lifecycle.decide({ ...input, approve: false }),
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
      agentOf: () => this.agentOfStop(input),
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
      agentOf: () => this.agentOfStop(input),
      run: () => this.lifecycle.retryStop(input),
    });
  }

  /**
   * Saves the plan and lets the open stop go of removed targets, one plan edit per agent at a time.
   * The platform check runs before the lock; under it only database work runs. The save writes one
   * audit row naming the agent, and so does a refused one; a failure after the save is no refusal.
   */
  async setPlan({
    caller,
    ...input
  }: AgentStopPlanInput & { caller: AgentStopCaller }): Promise<AgentStopPlan> {
    const { plan, agent } = await this.deps.requestAudit.recordingRefusal({
      action: AGENT_STOP_PLAN_SET_ACTION,
      organizationId: input.organizationId,
      caller,
      agentId: input.agentId,
      agentOf: () => this.agentOfEntry(input),
      run: () => this.savePlanOnce(input),
    });
    await this.deps.requestAudit.recordPlanSet({
      organizationId: input.organizationId,
      agent,
      caller,
      plan,
    });
    return plan;
  }

  /** The agent is read before the save, so a refusal reading it never follows a saved plan. */
  private async savePlanOnce(
    input: AgentStopPlanInput,
  ): Promise<{ plan: AgentStopPlan; agent: AgentStopAuditAgent }> {
    await this.deps.plans.checkPlan(input);
    const agent = await this.agentOfEntry(input);
    const plan = await this.deps.locks.withLock({
      key: agentLockKey(input),
      run: async () => {
        const saved = await this.deps.plans.savePlan(input);
        await this.lifecycle.dropRemovedTargets({
          organizationId: input.organizationId,
          agentId: input.agentId,
          plan: saved.targets,
        });
        return saved;
      },
    });
    return { plan, agent };
  }

  /** The registry agent a request names, for its audit row. */
  private async agentOfEntry({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopAuditAgent> {
    const entry = await this.deps.registry.getEntry({ organizationId, id: agentId });
    return { agentId, agentName: entry.name };
  }

  /** The agent a stop is about, for the audit row of a request on that stop. */
  private async agentOfStop({
    organizationId,
    stopId,
  }: {
    organizationId: string;
    stopId: string;
  }): Promise<AgentStopAuditAgent> {
    const stop = await this.deps.stops.getStop({ organizationId, stopId });
    return { agentId: stop.agentId, agentName: stop.agentName };
  }

  /** After the agent's plan changed, the open stop lets go of what the plan no longer holds. */
  dropRemovedTargets(
    input: Parameters<AgentStopLifecycleService["dropRemovedTargets"]>[0],
  ): Promise<void> {
    return this.lifecycle.dropRemovedTargets(input);
  }

  getLatestStop(
    input: Parameters<AgentStopReadsService["getLatestStop"]>[0],
  ): Promise<AgentStopView> {
    return this.reads.getLatestStop(input);
  }

  listStops(input: Parameters<AgentStopReadsService["listStops"]>[0]): Promise<AgentStopPage> {
    return this.reads.listStops(input);
  }

  findPendingApprovals(
    input: Parameters<AgentStopReadsService["findPendingApprovals"]>[0],
  ): Promise<AgentStopView[]> {
    return this.reads.findPendingApprovals(input);
  }

  findSummaries(
    input: Parameters<AgentStopReadsService["findSummaries"]>[0],
  ): Promise<AgentKillSwitchSummary[]> {
    return this.reads.findSummaries(input);
  }
}
