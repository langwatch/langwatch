/**
 * The Instant Eval run process: pure state logic, no effects.
 *
 * The whole run is four moves, and each one is an event driving the next
 * intent rather than a step inside a long-lived handler:
 *
 *   requested  -> plan
 *   planned    -> judge page 1
 *   page_judged with more to do -> judge page n + 1
 *   page_judged with nothing left, or a cancellation, or a stall -> finish
 *
 * There is no progress channel and there does not need to be one: a judged page
 * IS the progress report, and the run's row is folded from those events. That is
 * also what makes the job resumable, a pod that dies mid-page loses the page,
 * not the run, because the next delivery starts from the cursor the last
 * recorded page ended on.
 *
 * Two traps the runtime imposes, both handled here:
 *
 *  - an omitted `nextWakeAt` CLEARS the wake, so every no-op branch re-derives
 *    the wake it means to keep ({@link currentWake});
 *  - a wake is scheduled from `max(ctx.at, ctx.now)`, never from `ctx.at`, or a
 *    backed-up subscriber arms a wake already in the past.
 *
 * @see ./instantEvalProcess.types.ts: the state and the payload boundary
 * @see ./instantEvalProcess.helpers.ts: the outbox keys and the evolutions
 * @see ./instantEvalIntentHandlers.ts: the effects
 */

import type {
  EventHandler,
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { InstantEvalProcessingEvent } from "../schemas/events";
import {
  active,
  currentWake,
  finishKey,
  pageKey,
  pageSizeFor,
  planKey,
  schedulingRef,
  unchanged,
} from "./instantEvalProcess.helpers";
import {
  INSTANT_EVAL_CANCEL_GRACE_MS,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
  type InstantEvalProcessEventView,
  type InstantEvalProcessState,
  type instantEvalFinishIntentSchema,
  type instantEvalJudgePageIntentSchema,
  type instantEvalPlanIntentSchema,
  instantEvalProcessEventViewSchema,
} from "./instantEvalProcess.types";

/** The intents this process may emit, typed so handlers get `ctx.intents.plan`. */
export type InstantEvalIntents = {
  plan: IntentSpec<typeof instantEvalPlanIntentSchema>;
  judgePage: IntentSpec<typeof instantEvalJudgePageIntentSchema>;
  finish: IntentSpec<typeof instantEvalFinishIntentSchema>;
};

export const handleRunRequested: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const data = instantEvalProcessEventViewSchema.parse(payload);
  // A redelivered request must not re-plan a run already under way: the
  // aggregate is the run, so anything past idle has already been planned and
  // the inbox key is the only thing that would have caught an exact duplicate.
  if (state.phase !== "idle") return unchanged(state);
  const refMs = schedulingRef(ctx);
  return active({
    state: { ...state, phase: "planning" },
    refMs,
    intents: [
      ctx.intents.plan(planKey(data.runId), {
        runId: data.runId,
        projectId: ctx.projectId,
      }),
    ],
  });
};

export const handleRunPlanned: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const data = instantEvalProcessEventViewSchema.parse(payload);
  if (state.phase === "terminal") return unchanged(state);
  const refMs = schedulingRef(ctx);

  // A statement that matched nothing is a finished run, not a failed one: the
  // question was asked and the answer is that nothing was there to judge.
  if (data.total <= 0) {
    return active({
      state: { ...state, phase: "terminal" },
      refMs,
      intents: [
        ctx.intents.finish(finishKey({ runId: data.runId, reason: "empty" }), {
          runId: data.runId,
          projectId: ctx.projectId,
          outcome: "finished",
          errorCode: null,
          inputTokens: state.inputTokens,
          requests: state.requests,
        }),
      ],
    });
  }

  const planned: InstantEvalProcessState = {
    ...state,
    phase: state.phase === "cancelling" ? "cancelling" : "running",
    pageSize: data.pageSize,
    keyColumns: data.keyColumns,
    remaining: data.total,
    page: 0,
    cursor: null,
    cursorSpanId: null,
  };
  // A run cancelled while it was still planning never judges a page.
  if (planned.phase === "cancelling") {
    return active({
      state: { ...planned, phase: "terminal" },
      refMs,
      intents: [
        ctx.intents.finish(
          finishKey({ runId: data.runId, reason: "cancelled" }),
          {
            runId: data.runId,
            projectId: ctx.projectId,
            outcome: "cancelled",
            errorCode: null,
            inputTokens: state.inputTokens,
            requests: state.requests,
          },
        ),
      ],
    });
  }

  return active({
    state: planned,
    refMs,
    intents: [
      ctx.intents.judgePage(pageKey({ runId: data.runId, page: 1 }), {
        runId: data.runId,
        projectId: ctx.projectId,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: pageSizeFor(planned),
        remaining: planned.remaining,
        keyColumns: [...planned.keyColumns],
      }),
    ],
  });
};

export const handlePageJudged: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const data = instantEvalProcessEventViewSchema.parse(payload);
  if (state.phase === "terminal") return unchanged(state);
  // A page the run already counted: the inbox dedups an exact redelivery, and
  // this catches the rest, so a page that arrives twice cannot advance the
  // cursor twice or spend the run's remaining rows twice.
  if (data.page <= state.page) return unchanged(state);

  const refMs = schedulingRef(ctx);
  const advanced: InstantEvalProcessState = {
    ...state,
    page: data.page,
    cursor: data.cursor,
    cursorSpanId: data.cursorSpanId,
    remaining: Math.max(0, state.remaining - data.rows),
    inputTokens: state.inputTokens + data.inputTokens,
    requests: state.requests + data.requests,
  };

  const isCancelling = state.phase === "cancelling";
  const isDone = !data.hasNextPage || advanced.remaining <= 0;
  if (isCancelling || isDone) {
    return active({
      state: { ...advanced, phase: "terminal" },
      refMs,
      intents: [
        ctx.intents.finish(
          finishKey({
            runId: data.runId,
            reason: isCancelling ? "cancelled" : "done",
          }),
          {
            runId: data.runId,
            projectId: ctx.projectId,
            outcome: isCancelling ? "cancelled" : "finished",
            errorCode: null,
            inputTokens: advanced.inputTokens,
            requests: advanced.requests,
          },
        ),
      ],
    });
  }

  const nextPage = data.page + 1;
  return active({
    state: advanced,
    refMs,
    intents: [
      ctx.intents.judgePage(pageKey({ runId: data.runId, page: nextPage }), {
        runId: data.runId,
        projectId: ctx.projectId,
        page: nextPage,
        afterTraceId: advanced.cursor,
        afterSpanId: advanced.cursorSpanId,
        pageSize: pageSizeFor(advanced),
        remaining: advanced.remaining,
        keyColumns: [...advanced.keyColumns],
      }),
    ],
  });
};

export const handleCancelRequested: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, _payload, ctx) => {
  if (state.phase === "terminal") return unchanged(state);
  const refMs = schedulingRef(ctx);
  // No intent: the page in flight reads the cancellation itself and stops
  // between chunks, and the next page is simply never emitted. The wake below
  // is the backstop for a page that never reports back.
  const cancelling: InstantEvalProcessState = {
    ...state,
    phase: "cancelling",
    cancelRequestedAtMs: refMs,
    lastActivityAtMs: refMs,
  };
  return { state: cancelling, nextWakeAt: currentWake(cancelling) };
};

export const handleRunFinished: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state) => {
  const terminal: InstantEvalProcessState = { ...state, phase: "terminal" };
  return { state: terminal, nextWakeAt: null };
};

export const instantEvalWake: WakeHandler<
  InstantEvalProcessState,
  InstantEvalIntents
> = (state, ctx) => {
  const runId = ctx.key;

  // A wake for a run nothing ever touched has to clear itself, or the wake
  // worker re-finds it forever.
  if (state.phase === "terminal" || state.phase === "idle") {
    return { state, nextWakeAt: null };
  }

  if (state.phase === "cancelling") {
    const requestedAtMs = state.cancelRequestedAtMs ?? ctx.now;
    if (ctx.now - requestedAtMs < INSTANT_EVAL_CANCEL_GRACE_MS) {
      return {
        state,
        nextWakeAt: requestedAtMs + INSTANT_EVAL_CANCEL_GRACE_MS,
      };
    }
    // The page in flight never reported back. The same message key the normal
    // cancelled path uses, so the outbox dedups if that one did dispatch.
    return {
      state: { ...state, phase: "terminal" },
      nextWakeAt: null,
      intents: [
        ctx.intents.finish(finishKey({ runId, reason: "cancelled" }), {
          runId,
          projectId: ctx.projectId,
          outcome: "cancelled",
          errorCode: null,
          inputTokens: state.inputTokens,
          requests: state.requests,
        }),
      ],
    };
  }

  if (ctx.now - state.lastActivityAtMs < INSTANT_EVAL_STALL_THRESHOLD_MS) {
    return {
      state,
      nextWakeAt: state.lastActivityAtMs + INSTANT_EVAL_STALL_THRESHOLD_MS,
    };
  }

  // The stall is recorded as a durable outcome rather than derived at read
  // time, so a run that stopped says so instead of reading as still running.
  return {
    state: { ...state, phase: "terminal" },
    nextWakeAt: null,
    intents: [
      ctx.intents.finish(finishKey({ runId, reason: "stalled" }), {
        runId,
        projectId: ctx.projectId,
        outcome: "failed",
        errorCode: "instant_eval_stalled",
        inputTokens: state.inputTokens,
        requests: state.requests,
      }),
    ],
  };
};

/**
 * The view of an event the process is given: ids, counts and nothing else.
 *
 * Built field by field rather than spread, because the default view is the raw
 * event data and `requested` carries the caller's whole statement.
 */
export function buildProcessEventView(
  event: InstantEvalProcessingEvent,
): InstantEvalProcessEventView {
  const data = event.data as Record<string, unknown>;
  const number = (key: string) =>
    typeof data[key] === "number" ? (data[key] as number) : 0;
  return {
    runId:
      typeof data.runId === "string" ? data.runId : String(event.aggregateId),
    rowLimit: number("rowLimit"),
    questions: Array.isArray(data.questions) ? data.questions.length : 0,
    total: number("total"),
    pageSize: number("pageSize"),
    keyColumns: Array.isArray(data.keyColumns)
      ? (data.keyColumns as string[])
      : [],
    page: number("page"),
    rows: number("rows"),
    failed: number("failed"),
    skipped: number("skipped"),
    inputTokens: number("inputTokens"),
    requests: number("requests"),
    cursor: typeof data.cursor === "string" ? data.cursor : null,
    cursorSpanId:
      typeof data.cursorSpanId === "string" ? data.cursorSpanId : null,
    hasNextPage: data.hasNextPage === true,
  };
}
