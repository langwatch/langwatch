// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The stop's process manager: folds the stop as the projection does, then asks the worker to
 * apply each target once the stop is immediate or approved, to revert what it applied once a
 * restore is asked, and to announce each milestone. Nothing runs on a timer.
 */
import {
  type AgentStopTargetOutcome,
  agentStopApprovedEventSchema,
  agentStopDeniedEventSchema,
  agentStopPlanTargetSchema,
  agentStopRequestedEventSchema,
  agentStopRestoreRequestedEventSchema,
  agentStopRetryRequestedEventSchema,
  agentStopTargetAppliedEventSchema,
  agentStopTargetFailedEventSchema,
  agentStopTargetRevertedEventSchema,
  agentStopTargetRevertFailedEventSchema,
  agentStopTargetsDroppedEventSchema,
  agentStopViewSchema,
  AGENT_STOP_WEBHOOK_EVENT_TYPES,
} from "@langwatch/enterprise-governance-contract";
import type {
  Event,
  IntentContext,
  IntentSpec,
  ProcessHandlerContext,
  ProcessIntent,
  ProcessManagerApplier,
} from "@langwatch/eventing";
import { z } from "zod";

import {
  type AgentStopRecord,
  agentStopRecordSchema,
  milestonesReached,
  viewOfStop,
} from "../rules/agent-stop.rules.ts";
import { foldAgentStop } from "./agent-stop.projection.ts";

export const AGENT_STOP_PROCESS_NAME = "agentStop" as const;
/** A platform call that fails this many times is recorded failed with its error code. */
export const AGENT_STOP_MAX_ATTEMPTS = 5;
/** Deliveries past the platform budget, for recording an outcome whose first record failed. */
const AGENT_STOP_SETTLE_ATTEMPTS = 5;

const AGENT_STOP_INTENT_TYPES = {
  APPLY: "applyTarget",
  REVERT: "revertTarget",
  ANNOUNCE: "announce",
} as const;

const targetWorkSchema = z.object({
  stopId: z.string().min(1),
  organizationId: z.string().min(1),
  agentId: z.string().min(1),
  reason: z.string(),
  /** Who the gateway records a virtual key disable or enable under. */
  actorUserId: z.string().min(1),
  target: agentStopPlanTargetSchema,
});
const agentStopApplyIntentSchema = z.object({
  ...targetWorkSchema.shape,
  /** The retry the apply belongs to, 0 for the stop's first run. */
  retryRound: z.number().int().nonnegative().default(0),
});
const agentStopRevertIntentSchema = z.object({
  ...targetWorkSchema.shape,
  restoreRound: z.number().int().nonnegative(),
  /** Set when a plan change dropped the target: the revert answers that drop, not a restore. */
  dropId: z.string().min(1).optional(),
});
const agentStopAnnounceIntentSchema = z.object({
  organizationId: z.string().min(1),
  milestone: z.enum(AGENT_STOP_WEBHOOK_EVENT_TYPES),
  /** The restore the milestone belongs to (0 before any), so each restore announces once. */
  restoreRound: z.number().int().nonnegative(),
  /** The retry the milestone belongs to (0 before any), so each retry announces once. */
  retryRound: z.number().int().nonnegative().default(0),
  /** When the event that reached the milestone happened; absent on intents queued before it was kept. */
  occurredAt: z.number().int().nonnegative().optional(),
  stop: agentStopViewSchema,
});
export type AgentStopApplyIntent = z.infer<typeof agentStopApplyIntentSchema>;
export type AgentStopRevertIntent = z.infer<typeof agentStopRevertIntentSchema>;
export type AgentStopAnnounceIntent = z.infer<typeof agentStopAnnounceIntentSchema>;

const agentStopProcessStateSchema = z.object({ stop: agentStopRecordSchema.nullable() });
type AgentStopProcessState = z.infer<typeof agentStopProcessStateSchema>;
const INITIAL_STATE: AgentStopProcessState = { stop: null };

type AgentStopIntents = {
  [AGENT_STOP_INTENT_TYPES.APPLY]: IntentSpec<typeof agentStopApplyIntentSchema>;
  [AGENT_STOP_INTENT_TYPES.REVERT]: IntentSpec<typeof agentStopRevertIntentSchema>;
  [AGENT_STOP_INTENT_TYPES.ANNOUNCE]: IntentSpec<typeof agentStopAnnounceIntentSchema>;
};
type Context = ProcessHandlerContext<AgentStopIntents>;

/** The worker's side of each intent. */
export interface AgentStopIntentExecutors {
  applyTarget(intent: AgentStopApplyIntent, context: IntentContext): Promise<void>;
  revertTarget(intent: AgentStopRevertIntent, context: IntentContext): Promise<void>;
  announce(intent: AgentStopAnnounceIntent, context: IntentContext): Promise<void>;
}

/**
 * A restore acts as whoever asked for it; a retried stop as whoever retried it; a stop as whoever
 * decided, else requested it. A machine
 * credential with no owner acts as a stable service principal named after the key, as the gateway
 * does for an ownerless key.
 */
function actorPairOf({
  stop,
  restoring,
}: {
  stop: AgentStopRecord;
  restoring: boolean;
}): [string | null, string | null] {
  if (restoring) return [stop.restoredByUserId, stop.restoredByApiKeyId];
  if (stop.retryRound > 0) return [stop.retriedByUserId, stop.retriedByApiKeyId];
  if (stop.decidedByUserId !== null || stop.decidedByApiKeyId !== null) {
    return [stop.decidedByUserId, stop.decidedByApiKeyId];
  }
  return [stop.requestedByUserId, stop.requestedByApiKeyId];
}

function actorUserIdOf({ stop, restoring }: { stop: AgentStopRecord; restoring: boolean }): string {
  const [person, key] = actorPairOf({ stop, restoring });
  if (person) return person;
  return key ? `svc_${key}` : `svc_${stop.id}`;
}

function work(stop: AgentStopRecord, target: AgentStopTargetOutcome, restoring: boolean) {
  return {
    stopId: stop.id,
    organizationId: stop.organizationId,
    agentId: stop.agentId,
    reason: stop.reason,
    actorUserId: actorUserIdOf({ stop, restoring }),
    target: { id: target.id, label: target.label, target: target.target },
  };
}

function isRevertingIn({
  stop,
  target,
}: {
  stop: AgentStopRecord | null;
  target: AgentStopTargetOutcome;
}): boolean {
  return (
    stop?.targets.some(
      (held) =>
        held.id === target.id && held.state === "reverting" && held.dropId === target.dropId,
    ) ?? false
  );
}

/** A dropped target that just turned reverting: its revert answers the drop that took it out. */
function dropRevertsOf({
  before,
  after,
  context,
}: {
  before: AgentStopRecord | null;
  after: AgentStopRecord;
  context: Pick<Context, "intent">;
}): ProcessIntent[] {
  return after.targets.flatMap((target) => {
    const { dropId } = target;
    if (!target.dropped || target.state !== "reverting" || dropId === undefined) return [];
    if (isRevertingIn({ stop: before, target })) return [];
    return [
      context.intent(AGENT_STOP_INTENT_TYPES.REVERT, `revert:${target.id}:drop:${dropId}`, {
        ...work(after, target, false),
        restoreRound: after.restoreRound,
        dropId,
      }),
    ];
  });
}

/** The intents one transition asks for: applies, reverts and a milestone. */
function intentsOfTransition({
  before,
  after,
  context,
}: {
  before: AgentStopRecord | null;
  after: AgentStopRecord;
  context: Pick<Context, "intent" | "at">;
}): ProcessIntent[] {
  const intents: ProcessIntent[] = [];
  if (after.status === "stopping" && before?.status !== "stopping") {
    for (const target of after.targets.filter(
      (outcome) => outcome.state === "pending" && outcome.dropped !== true,
    )) {
      const key =
        after.retryRound > 0 ? `apply:${target.id}:${after.retryRound}` : `apply:${target.id}`;
      intents.push(
        context.intent(AGENT_STOP_INTENT_TYPES.APPLY, key, {
          ...work(after, target, false),
          retryRound: after.retryRound,
        }),
      );
    }
  }
  if (after.restoreRound > (before?.restoreRound ?? 0)) {
    // A target already reverting has its revert in flight, a dropped one's included.
    for (const target of after.targets.filter(
      (outcome) =>
        outcome.state === "reverting" && !isRevertingIn({ stop: before, target: outcome }),
    )) {
      intents.push(
        context.intent(
          AGENT_STOP_INTENT_TYPES.REVERT,
          `revert:${target.id}:${after.restoreRound}`,
          {
            ...work(after, target, true),
            restoreRound: after.restoreRound,
          },
        ),
      );
    }
  }
  intents.push(...dropRevertsOf({ before, after, context }));
  for (const milestone of milestonesReached({
    before: before?.status ?? null,
    after: after.status,
  })) {
    const key = `announce:${milestone}:${after.restoreRound}`;
    intents.push(
      context.intent(
        AGENT_STOP_INTENT_TYPES.ANNOUNCE,
        after.retryRound > 0 ? `${key}:retry:${after.retryRound}` : key,
        {
          organizationId: after.organizationId,
          milestone,
          restoreRound: after.restoreRound,
          retryRound: after.retryRound,
          occurredAt: context.at,
          stop: viewOfStop(after),
        },
      ),
    );
  }
  return intents;
}

const HANDLED_EVENTS = [
  agentStopRequestedEventSchema,
  agentStopApprovedEventSchema,
  agentStopDeniedEventSchema,
  agentStopTargetAppliedEventSchema,
  agentStopTargetFailedEventSchema,
  agentStopRestoreRequestedEventSchema,
  agentStopTargetRevertedEventSchema,
  agentStopTargetRevertFailedEventSchema,
  agentStopRetryRequestedEventSchema,
  agentStopTargetsDroppedEventSchema,
] as const;

function evolve({
  state,
  type,
  data,
  context,
}: {
  state: AgentStopProcessState;
  type: string;
  data: unknown;
  context: Context;
}) {
  const after = foldAgentStop({ stop: state.stop, type, data, at: context.at });
  if (!after) return { state, nextWakeAt: null, intents: [] };
  return {
    state: { stop: after },
    nextWakeAt: null,
    intents: intentsOfTransition({ before: state.stop, after, context }),
  };
}

export function agentStopProcessManager({
  executors,
  retryDelayMs,
}: {
  executors: AgentStopIntentExecutors;
  /** The outbox's default backoff unless a test shortens it. */
  retryDelayMs?: (params: { attempt: number }) => number;
}): ProcessManagerApplier<Event> {
  return (process) => {
    let built = process
      .state(agentStopProcessStateSchema, INITIAL_STATE)
      .intent(AGENT_STOP_INTENT_TYPES.APPLY, agentStopApplyIntentSchema, (intent, context) =>
        executors.applyTarget(intent, context),
      )
      .intent(AGENT_STOP_INTENT_TYPES.REVERT, agentStopRevertIntentSchema, (intent, context) =>
        executors.revertTarget(intent, context),
      )
      .intent(AGENT_STOP_INTENT_TYPES.ANNOUNCE, agentStopAnnounceIntentSchema, (intent, context) =>
        executors.announce(intent, context),
      );
    for (const schema of HANDLED_EVENTS) {
      const type = String([...schema.shape.type.values][0]);
      built = built.on(schema, (state, data, context) => evolve({ state, type, data, context }));
    }
    return built.outbox({
      maxAttempts: AGENT_STOP_MAX_ATTEMPTS + AGENT_STOP_SETTLE_ATTEMPTS,
      ...(retryDelayMs ? { retryDelayMs } : {}),
    });
  };
}
