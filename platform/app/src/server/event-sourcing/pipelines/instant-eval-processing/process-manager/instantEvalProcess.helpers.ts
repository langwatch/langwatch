/**
 * The pure arithmetic the `instantEval` process is built from: its outbox
 * identities, its scheduling reference, and the two shapes an evolution takes.
 *
 * Separate from the handlers so each handler reads as the decision it makes
 * rather than as a mix of the decision and the bookkeeping. Every function
 * here is total and reads no clock except through the context it is given.
 *
 * @see ./instantEval.process.ts: the handlers that use these
 * @see ./instantEvalProcess.types.ts: the state they evolve
 */

import type {
  ProcessEvolution,
  ProcessHandlerContext,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { InstantEvalIntents } from "./instantEval.process";
import {
  INSTANT_EVAL_CANCEL_GRACE_MS,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
  type InstantEvalProcessState,
} from "./instantEvalProcess.types";

type Ctx = ProcessHandlerContext<InstantEvalIntents>;

/** Deterministic outbox identities, unique per process instance. */
export const planKey = (runId: string) => `plan:${runId}`;
export const pageKey = ({ runId, page }: { runId: string; page: number }) =>
  `page:${runId}:${page}`;
export const finishKey = ({
  runId,
  reason,
}: {
  runId: string;
  reason: string;
}) => `finish:${runId}:${reason}`;

/** Schedule from the later of the input's instant and now. */
export function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

/**
 * The wake a no-op has to keep.
 *
 * Stated explicitly because the runtime maps an omitted `nextWakeAt` to null,
 * so "leave the wake alone" is a value, not an omission.
 */
export function currentWake(state: InstantEvalProcessState): number | null {
  switch (state.phase) {
    case "terminal":
    case "idle":
      return null;
    case "cancelling":
      return state.cancelRequestedAtMs === null
        ? null
        : state.cancelRequestedAtMs + INSTANT_EVAL_CANCEL_GRACE_MS;
    default:
      return state.lastActivityAtMs + INSTANT_EVAL_STALL_THRESHOLD_MS;
  }
}

/** A commit that moved the run on, with the stall wake re-armed. */
export function active({
  state,
  refMs,
  intents,
}: {
  state: InstantEvalProcessState;
  refMs: number;
  intents?: ProcessEvolution<InstantEvalProcessState>["intents"];
}): ProcessEvolution<InstantEvalProcessState> {
  const next = { ...state, lastActivityAtMs: refMs };
  return {
    state: next,
    nextWakeAt: currentWake(next),
    ...(intents ? { intents } : {}),
  };
}

/** A commit that changed nothing, keeping whatever wake was armed. */
export function unchanged(
  state: InstantEvalProcessState,
): ProcessEvolution<InstantEvalProcessState> {
  return { state, nextWakeAt: currentWake(state) };
}

/** Rows one page judges, bounded by what the run may still judge. */
export function pageSizeFor(state: InstantEvalProcessState): number {
  return Math.max(1, Math.min(state.pageSize, state.remaining));
}
