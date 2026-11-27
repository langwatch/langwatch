// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentStopCaller, AgentStopPlan } from "@langwatch/enterprise-governance-contract";
import { HandledError } from "@langwatch/handled-error";

import type { AgentStopRecord } from "../rules/agent-stop.rules.ts";
import type { KillSwitchAuditService } from "./kill-switch-audit.service.ts";

/** The audit rows' target kind: the stop is about the registry agent. */
export const AGENT_STOP_AUDIT_TARGET_KIND = "governance_agent";
/** The one row a plan save writes, from the governance UI or over REST. */
export const AGENT_STOP_PLAN_SET_ACTION = "governance.agent.stop_plan_set";

/** The agent a row names: its registry id and the name people read. */
export type AgentStopAuditAgent = { agentId: string; agentName: string };

/**
 * Who a row names: the person, else the key, as the door's own rows do. An impersonated person's
 * operator goes in the actor column, as the generic trail records it.
 */
function auditActorOf(caller: AgentStopCaller): { userId?: string; actorUserId?: string } {
  const actor = caller.userId ?? (caller.apiKeyId ? `apikey:${caller.apiKeyId}` : null);
  return {
    ...(actor ? { userId: actor } : {}),
    ...(caller.impersonatorId ? { actorUserId: caller.impersonatorId } : {}),
  };
}

/** The trail of a stop's requests: the row each accepted one writes, and the row a refused one leaves. */
export class AgentStopRequestAuditService {
  private constructor(private readonly deps: { audit: Pick<KillSwitchAuditService, "record"> }) {}

  static create(deps: {
    audit: Pick<KillSwitchAuditService, "record">;
  }): AgentStopRequestAuditService {
    return new AgentStopRequestAuditService(deps);
  }

  /**
   * One row for an accepted request, naming the stop it acted on, dated at the moment it was asked
   * (`occurredAt`), so it lists before any milestone the request causes.
   */
  async record({
    action,
    stop,
    caller,
    note,
    occurredAt,
  }: {
    action: string;
    stop: AgentStopRecord;
    caller: AgentStopCaller;
    note?: string;
    occurredAt: number;
  }): Promise<void> {
    await this.deps.audit.record({
      occurredAt,
      ...auditActorOf(caller),
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
        ...(caller.impersonatorId ? { impersonatorId: caller.impersonatorId } : {}),
        ...(note ? { note } : {}),
      },
    });
  }

  /** One row for a saved plan, naming the agent and what the plan now holds. */
  async recordPlanSet({
    organizationId,
    agent,
    caller,
    plan,
  }: {
    organizationId: string;
    agent: AgentStopAuditAgent;
    caller: AgentStopCaller;
    plan: AgentStopPlan;
  }): Promise<void> {
    await this.deps.audit.record({
      ...auditActorOf(caller),
      organizationId,
      action: AGENT_STOP_PLAN_SET_ACTION,
      targetKind: AGENT_STOP_AUDIT_TARGET_KIND,
      targetId: agent.agentId,
      metadata: {
        targetName: agent.agentName,
        agentName: agent.agentName,
        version: plan.version,
        targets: plan.targets.map((target) => target.label),
        apiKeyId: caller.apiKeyId,
        ...(caller.impersonatorId ? { impersonatorId: caller.impersonatorId } : {}),
      },
    });
  }

  /**
   * Runs one request and records a refused attempt under the action it asked for, naming the
   * agent when `agentOf` finds it. The transports leave these calls out of the generic trail, so
   * this row is the only one a blocked self-approval or a stale plan leaves.
   */
  async recordingRefusal<T>({
    action,
    organizationId,
    caller,
    agentId,
    agentOf,
    stopId,
    run,
  }: {
    action: string;
    organizationId: string;
    caller: AgentStopCaller;
    agentId?: string;
    agentOf?: () => Promise<AgentStopAuditAgent>;
    stopId?: string;
    run: () => Promise<T>;
  }): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      const agent = await agentOf?.().catch(() => undefined);
      const targetId = agent?.agentId ?? agentId;
      await this.deps.audit.record({
        ...auditActorOf(caller),
        organizationId,
        action,
        error: error.code,
        ...(targetId ? { targetKind: AGENT_STOP_AUDIT_TARGET_KIND, targetId } : {}),
        metadata: {
          ...(agent ? { targetName: agent.agentName, agentName: agent.agentName } : {}),
          ...(stopId ? { stopId } : {}),
          apiKeyId: caller.apiKeyId,
          ...(caller.impersonatorId ? { impersonatorId: caller.impersonatorId } : {}),
        },
      });
      throw error;
    }
  }
}
