// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type {
  AgentStopView,
  AgentStopWebhookEventType,
} from "@langwatch/enterprise-governance-contract";
import type { IntentContext } from "@langwatch/eventing";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";

import type { AgentStopTargetPriorStateRepository } from "../../../repositories/agent-stop-target-prior-state.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type { AgentRegistryService } from "../../registry/services/agent-registry.service.ts";
import {
  AGENT_STOP_MAX_ATTEMPTS,
  type AgentStopAnnounceIntent,
  type AgentStopApplyIntent,
  type AgentStopIntentExecutors,
  type AgentStopRevertIntent,
} from "../eventing/agent-stop.process.ts";
import {
  errorCodeOf,
  isGoneErrorCode,
  TARGET_NOT_FOUND_ERROR_CODE,
  TARGET_NOT_IN_PLAN_ERROR_CODE,
  targetKeyOf,
} from "../rules/agent-stop-target.rules.ts";
import { isApplySuperseded, isRevertSuperseded } from "../rules/agent-stop.rules.ts";
import type { AgentStopPlanService } from "./agent-stop-plan.service.ts";
import {
  type AgentStopPlatformDependencies,
  AgentStopPlatformService,
  type AgentStopTargetWork,
  type Direction,
} from "./agent-stop-platform.service.ts";
import { AGENT_STOP_AUDIT_TARGET_KIND } from "./agent-stop-request-audit.service.ts";
import type { AgentStopCommandSend } from "./agent-stop.service.ts";

/** The audit log takes an `audit` KSUID as a key, and reads the row's moment from it. */
const AUDIT_KEY_RESOURCE = "audit";

/** The round a milestone belongs to; a retry's milestones carry its round as well. */
function milestoneRoundOf({
  restoreRound,
  retryRound = 0,
}: {
  restoreRound: number;
  retryRound?: number;
}): string {
  return retryRound > 0 ? `${restoreRound}_retry_${retryRound}` : String(restoreRound);
}

/** The stop's moments in epoch ms, absent ones left out. */
function momentsOf(moments: readonly (string | null)[]): number[] {
  return moments.flatMap((at) => (at ? [Temporal.Instant.from(at).epochMilliseconds] : []));
}

/**
 * When a milestone was reached, to the millisecond: one after both the intent's moment (else the
 * stop's latest one) and the stop's latest request, so the request's row, dated when it was asked,
 * lists first even when the request reached the milestone itself. Webhook and audit row share it.
 */
export function milestoneMomentOf({
  stop,
  occurredAt,
}: {
  stop: AgentStopView;
  occurredAt?: number;
}): number {
  const asked = momentsOf([stop.requestedAt, stop.decidedAt, stop.restoreRequestedAt]);
  const reached =
    occurredAt ?? Math.max(...asked, ...momentsOf([stop.quarantinedAt, stop.restoredAt]));
  return Math.max(reached, ...asked) + 1;
}

/**
 * The audit key of one announced milestone: derived from the stop, milestone and its rounds, so a
 * redelivered announcement names one row, minted in the second of its moment `at`.
 */
export function milestoneAuditKeyOf({
  stop,
  milestone,
  restoreRound,
  retryRound = 0,
  at,
}: {
  stop: AgentStopView;
  milestone: AgentStopWebhookEventType;
  restoreRound: number;
  retryRound?: number;
  at: number;
}): string {
  const round = milestoneRoundOf({ restoreRound, retryRound });
  const digest = createHash("sha256").update(`${stop.id}\u001f${milestone}\u001f${round}`).digest();
  return new Ksuid({
    environment: getEnvironment(),
    resource: AUDIT_KEY_RESOURCE,
    timestamp: Math.floor(at / 1000),
    instance: new Instance(Instance.schemes.RANDOM, new Uint8Array(digest.subarray(0, 8))),
    sequenceId: digest.readUInt32BE(8) >>> 1,
  }).toString();
}

interface AgentStopTargetDependencies {
  send: AgentStopCommandSend;
  platform: Pick<AgentStopPlatformService, "call">;
  priorStates: Pick<AgentStopTargetPriorStateRepository, "findPriorStates">;
  registry: Pick<AgentRegistryService, "announceStop">;
  stops: Pick<AgentStopRepository, "getStop">;
  plans: Pick<AgentStopPlanService, "findTargets">;
  auditLog: Pick<AuditLogApi, "record">;
  maxAttempts: number;
  now: () => number;
  logger: Logger;
}

/**
 * The worker's half of a stop: one platform call per intent, then the outcome recorded as a
 * command. A failing call is thrown back to the outbox until `maxAttempts`; later attempts record
 * the target failed instead, and only a failing record is retried, within the outbox's own budget.
 * Whether a target was stopped before the stop is recorded once, before the first call.
 */
export class AgentStopTargetService implements AgentStopIntentExecutors {
  private constructor(private readonly deps: AgentStopTargetDependencies) {}

  /** The platform calls are its own collaborator, built from the same dependencies. */
  static create({
    maxAttempts = AGENT_STOP_MAX_ATTEMPTS,
    now = () => nowInstant().epochMilliseconds,
    logger = createLogger("langwatch:governance:kill-switch"),
    send,
    registry,
    plans,
    auditLog,
    ...platform
  }: Omit<
    AgentStopTargetDependencies,
    "maxAttempts" | "now" | "logger" | "platform" | "stops" | "priorStates"
  > &
    Omit<AgentStopPlatformDependencies, "now" | "stops"> & {
      stops: Pick<AgentStopRepository, "getStop" | "findAllByStatuses">;
      maxAttempts?: number;
      now?: () => number;
      logger?: Logger;
    }): AgentStopTargetService {
    return new AgentStopTargetService({
      send,
      registry,
      plans,
      auditLog,
      stops: platform.stops,
      priorStates: platform.priorStates,
      platform: AgentStopPlatformService.create({ ...platform, now }),
      maxAttempts,
      now,
      logger,
    });
  }

  async applyTarget(intent: AgentStopApplyIntent, context: IntentContext): Promise<void> {
    const stop = await this.deps.stops.getStop({
      organizationId: intent.organizationId,
      stopId: intent.stopId,
    });
    if (isApplySuperseded({ stop, retryRound: intent.retryRound })) {
      this.skipSuperseded({ intent, direction: "stop" });
      return;
    }
    const outcome = (await this.isInPlan(intent))
      ? await this.attempt({ intent, direction: "stop", context })
      : { ok: false, changed: false, gone: false, errorCode: TARGET_NOT_IN_PLAN_ERROR_CODE };
    const settled = {
      tenantId: intent.organizationId,
      occurredAt: this.deps.now(),
      stopId: intent.stopId,
      organizationId: intent.organizationId,
      targetId: intent.target.id,
      errorCode: outcome.errorCode,
      ...(intent.retryRound > 0 ? { retryRound: intent.retryRound } : {}),
      ...(outcome.ok && !outcome.changed ? { alreadyStopped: true } : {}),
      ...(outcome.gone ? { gone: true } : {}),
    };
    await this.deps.send(outcome.ok ? "recordTargetApplied" : "recordTargetFailed", settled);
  }

  /** A target taken out of the plan left the stop: its queued apply is recorded failed, uncalled. */
  private async isInPlan(intent: AgentStopApplyIntent): Promise<boolean> {
    const plan = await this.deps.plans.findTargets({
      organizationId: intent.organizationId,
      agentId: intent.agentId,
    });
    const key = targetKeyOf(intent.target.target);
    return plan.some((target) => targetKeyOf(target.target) === key);
  }

  async revertTarget(intent: AgentStopRevertIntent, context: IntentContext): Promise<void> {
    const stop = await this.deps.stops.getStop({
      organizationId: intent.organizationId,
      stopId: intent.stopId,
    });
    const superseded = isRevertSuperseded({
      stop,
      targetId: intent.target.id,
      restoreRound: intent.restoreRound,
      dropId: intent.dropId,
    });
    if (superseded) {
      this.skipSuperseded({ intent, direction: "restore" });
      return;
    }
    const outcome = await this.attempt({ intent, direction: "restore", context });
    const settled = {
      tenantId: intent.organizationId,
      occurredAt: this.deps.now(),
      stopId: intent.stopId,
      organizationId: intent.organizationId,
      targetId: intent.target.id,
      errorCode: outcome.errorCode,
      ...(intent.dropId ? { dropId: intent.dropId } : { restoreRound: intent.restoreRound }),
      ...(outcome.gone ? { gone: true } : {}),
      ...(outcome.keptDisabled ? { keptDisabled: true } : {}),
    };
    await this.deps.send(outcome.ok ? "recordTargetReverted" : "recordTargetRevertFailed", settled);
  }

  /**
   * A retried intent the stop moved past: the platform is left alone, since a newer round owns the
   * target now, and nothing is recorded, since the fold would drop the stale outcome anyway.
   */
  private skipSuperseded({
    intent,
    direction,
  }: {
    intent: AgentStopApplyIntent | AgentStopRevertIntent;
    direction: Direction;
  }): void {
    this.deps.logger.info(
      {
        direction,
        stopId: intent.stopId,
        targetId: intent.target.id,
        organizationId: intent.organizationId,
      },
      "kill switch target intent superseded by a newer round; platform left alone",
    );
  }

  /**
   * The webhooks first, then the audit row; both carry every target's outcome. The
   * request's own row was written by whoever asked, so a stop_requested milestone is pushed only.
   */
  async announce(intent: AgentStopAnnounceIntent): Promise<void> {
    const { organizationId, milestone, restoreRound, retryRound, occurredAt, stop } = intent;
    const round = milestoneRoundOf({ restoreRound, retryRound });
    const at = milestoneMomentOf({ stop, ...(occurredAt === undefined ? {} : { occurredAt }) });
    await this.deps.registry.announceStop({
      organizationId,
      eventId: `${stop.id}_${milestone.replace("governance.agent.", "")}_${round}`,
      milestone,
      occurredAt: at,
      stop,
    });
    if (milestone === "governance.agent.stop_requested") return;
    await this.deps.auditLog.record({
      idempotencyKey: milestoneAuditKeyOf({ stop, milestone, restoreRound, retryRound, at }),
      occurredAt: at,
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
        ...(retryRound > 0 ? { retryRound } : {}),
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
    intent: AgentStopTargetWork;
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
      const { changed, keptDisabled } = await this.deps.platform.call({
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
      if (isGoneErrorCode(errorCode)) {
        // On a stop's first contact a 404 is a wrong region, account or id, not a deleted resource.
        if (direction === "restore" || (await this.hasTouched(intent))) {
          return { ok: true, changed: false, gone: true, errorCode: null };
        }
        return { ok: false, changed: false, gone: false, errorCode: TARGET_NOT_FOUND_ERROR_CODE };
      }
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

  /** True once this stop recorded the target's prior state: an earlier call of it reached the platform. */
  private async hasTouched(intent: AgentStopTargetWork): Promise<boolean> {
    const recorded = await this.deps.priorStates.findPriorStates({
      organizationId: intent.organizationId,
      stopId: intent.stopId,
      targetId: intent.target.id,
    });
    return recorded.length > 0;
  }
}
