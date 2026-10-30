/**
 * The Instant Eval run process: pure state logic, no effects. Requested plans,
 * planned judges page one, a judged page judges the next or finishes.
 * @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessIntent,
  WakeHandler,
} from "@langwatch/eventing";
import type { InstantEvalProcessingEvent } from "@langwatch/instant-eval-contract";
import { pickInstantEvalRoutedSpend } from "@langwatch/instant-eval-judge-contract";

import {
  INSTANT_EVAL_CANCEL_GRACE_MS,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
  type instantEvalBillLatePageIntentSchema,
  type instantEvalFinishIntentSchema,
  type instantEvalJudgePageIntentSchema,
  type instantEvalPlanIntentSchema,
  type InstantEvalProcessEventView,
  instantEvalProcessEventViewSchema,
  type InstantEvalProcessState,
} from "./instant-eval-processing-data.process.ts";

/** The intents this process may emit, typed so handlers get `ctx.intents.plan`. */
export type InstantEvalIntents = {
  plan: IntentSpec<typeof instantEvalPlanIntentSchema>;
  judgePage: IntentSpec<typeof instantEvalJudgePageIntentSchema>;
  finish: IntentSpec<typeof instantEvalFinishIntentSchema>;
  billLatePage: IntentSpec<typeof instantEvalBillLatePageIntentSchema>;
};

type InstantEvalContext = ProcessHandlerContext<InstantEvalIntents>;

/** Deterministic outbox identities, unique per process instance. */
const instantEvalPlanKey = (runId: string): string => `plan:${runId}`;

const instantEvalPageIntentKey = ({ runId, page }: { runId: string; page: number }): string =>
  `page:${runId}:${page}`;

const instantEvalFinishKey = ({ runId, reason }: { runId: string; reason: string }): string =>
  `finish:${runId}:${reason}`;

const instantEvalLatePageKey = ({ runId, page }: { runId: string; page: number }): string =>
  `late-page:${runId}:${page}`;

type InstantEvalLatePage = InstantEvalProcessState["unbilledLatePages"][number];

function instantEvalBillLatePage({
  ctx,
  runId,
  late,
}: {
  ctx: InstantEvalContext;
  runId: string;
  late: InstantEvalLatePage;
}): ProcessIntent {
  return ctx.intent("billLatePage", instantEvalLatePageKey({ runId, page: late.page }), {
    ...late,
    runId,
    projectId: ctx.projectId,
  });
}

/**
 * A page that reports after the run ended: the finish already summed the run without it. A routed
 * page is paid for, so it is billed on its own once the finish has landed, never dropped. A page
 * with no routed spend changes nothing, as before the router (the finish never bills it).
 */
function instantEvalLatePageJudged({
  state,
  data,
  ctx,
}: {
  state: InstantEvalProcessState;
  data: InstantEvalProcessEventView;
  ctx: InstantEvalContext;
}): ProcessEvolution<InstantEvalProcessState> {
  if (data.page <= state.page) return instantEvalUnchanged(state);
  if (!pickInstantEvalRoutedSpend(data)) return instantEvalUnchanged(state);
  const late: InstantEvalLatePage = {
    page: data.page,
    inputTokens: data.inputTokens,
    requests: data.requests,
    costNanoUsd: data.costNanoUsd,
    routedInputTokens: data.routedInputTokens,
  };
  const counted = { ...state, page: data.page };
  if (!state.isFinishRecorded) {
    return {
      state: { ...counted, unbilledLatePages: [...state.unbilledLatePages, late] },
      ...instantEvalWakeFor(counted),
    };
  }
  return {
    state: counted,
    ...instantEvalWakeFor(counted),
    intents: [instantEvalBillLatePage({ ctx, runId: data.runId, late })],
  };
}

/** Schedule from the later of the input's instant and now. */
function instantEvalSchedulingRef(ctx: InstantEvalContext): number {
  return Math.max(ctx.at, ctx.now);
}

/**
 * The wake a no-op has to keep, stated explicitly because the runtime maps an
 * omitted `nextWakeAt` to null: "leave the wake alone" is a value here, never
 * an omission.
 */
function instantEvalWakeFor(
  state: InstantEvalProcessState,
): Pick<ProcessEvolution<InstantEvalProcessState>, "nextWakeAt"> {
  switch (state.phase) {
    case "terminal":
    case "idle":
      return { nextWakeAt: null };
    case "cancelling":
      return {
        nextWakeAt:
          state.cancelRequestedAtMs === null
            ? null
            : state.cancelRequestedAtMs + INSTANT_EVAL_CANCEL_GRACE_MS,
      };
    default:
      return { nextWakeAt: state.lastActivityAtMs + INSTANT_EVAL_STALL_THRESHOLD_MS };
  }
}

/** A commit that moved the run on, with the stall wake re-armed. */
function instantEvalActive({
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
    ...instantEvalWakeFor(next),
    ...(intents ? { intents } : {}),
  };
}

/** A commit that changed nothing, keeping whatever wake was armed. */
function instantEvalUnchanged(
  state: InstantEvalProcessState,
): ProcessEvolution<InstantEvalProcessState> {
  return { state, ...instantEvalWakeFor(state) };
}

/** Rows one page judges, bounded by what the run may still judge. */
function instantEvalPageSizeFor(state: InstantEvalProcessState): number {
  return Math.max(1, Math.min(state.pageSize, state.remaining));
}

export const handleInstantEvalRequested: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const data = instantEvalProcessEventViewSchema.parse(payload);
  // A redelivered request must not re-plan a run already under way: the
  // aggregate is the run, so anything past idle has already been planned.
  if (state.phase !== "idle") return instantEvalUnchanged(state);

  return instantEvalActive({
    state: { ...state, phase: "planning" },
    refMs: instantEvalSchedulingRef(ctx),
    intents: [
      ctx.intent("plan", instantEvalPlanKey(data.runId), {
        runId: data.runId,
        projectId: ctx.projectId,
      }),
    ],
  });
};

export const handleInstantEvalPlanned: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const data = instantEvalProcessEventViewSchema.parse(payload);
  if (state.phase === "terminal") return instantEvalUnchanged(state);
  const refMs = instantEvalSchedulingRef(ctx);

  // A statement that matched nothing is a finished run, not a failed one: the
  // question was asked and nothing was there to judge.
  if (data.total <= 0) {
    return instantEvalActive({
      state: { ...state, phase: "terminal" },
      refMs,
      intents: [
        ctx.intent("finish", instantEvalFinishKey({ runId: data.runId, reason: "empty" }), {
          runId: data.runId,
          projectId: ctx.projectId,
          outcome: "finished",
          errorCode: null,
          inputTokens: state.inputTokens,
          requests: state.requests,
          costNanoUsd: state.costNanoUsd,
          routedInputTokens: state.routedInputTokens,
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
    return instantEvalActive({
      state: { ...planned, phase: "terminal" },
      refMs,
      intents: [
        ctx.intent("finish", instantEvalFinishKey({ runId: data.runId, reason: "cancelled" }), {
          runId: data.runId,
          projectId: ctx.projectId,
          outcome: "cancelled",
          errorCode: null,
          inputTokens: state.inputTokens,
          requests: state.requests,
          costNanoUsd: state.costNanoUsd,
          routedInputTokens: state.routedInputTokens,
        }),
      ],
    });
  }

  return instantEvalActive({
    state: planned,
    refMs,
    intents: [
      ctx.intent("judgePage", instantEvalPageIntentKey({ runId: data.runId, page: 1 }), {
        runId: data.runId,
        projectId: ctx.projectId,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: instantEvalPageSizeFor(planned),
        remaining: planned.remaining,
        keyColumns: [...planned.keyColumns],
      }),
    ],
  });
};

export const handleInstantEvalPageJudged: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const data = instantEvalProcessEventViewSchema.parse(payload);
  if (state.phase === "terminal") return instantEvalLatePageJudged({ state, data, ctx });
  // A page the run already counted: the inbox dedups an exact redelivery, and
  // this catches the rest, so a page arriving twice cannot advance the cursor
  // twice or spend the run's remaining rows twice.
  if (data.page <= state.page) return instantEvalUnchanged(state);

  const refMs = instantEvalSchedulingRef(ctx);
  const advanced: InstantEvalProcessState = {
    ...state,
    page: data.page,
    cursor: data.cursor,
    cursorSpanId: data.cursorSpanId,
    remaining: Math.max(0, state.remaining - data.rows),
    inputTokens: state.inputTokens + data.inputTokens,
    requests: state.requests + data.requests,
    costNanoUsd: state.costNanoUsd + data.costNanoUsd,
    routedInputTokens: state.routedInputTokens + data.routedInputTokens,
  };

  const isCancelling = state.phase === "cancelling";
  const isDone = !data.hasNextPage || advanced.remaining <= 0;
  if (isCancelling || isDone) {
    return instantEvalActive({
      state: { ...advanced, phase: "terminal" },
      refMs,
      intents: [
        ctx.intent(
          "finish",
          instantEvalFinishKey({
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
            costNanoUsd: advanced.costNanoUsd,
            routedInputTokens: advanced.routedInputTokens,
          },
        ),
      ],
    });
  }

  const nextPage = data.page + 1;

  return instantEvalActive({
    state: advanced,
    refMs,
    intents: [
      ctx.intent("judgePage", instantEvalPageIntentKey({ runId: data.runId, page: nextPage }), {
        runId: data.runId,
        projectId: ctx.projectId,
        page: nextPage,
        afterTraceId: advanced.cursor,
        afterSpanId: advanced.cursorSpanId,
        pageSize: instantEvalPageSizeFor(advanced),
        remaining: advanced.remaining,
        keyColumns: [...advanced.keyColumns],
      }),
    ],
  });
};

export const handleInstantEvalCancelRequested: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, _payload, ctx) => {
  if (state.phase === "terminal") return instantEvalUnchanged(state);
  const refMs = instantEvalSchedulingRef(ctx);
  // No intent: the page in flight reads the cancellation itself and stops
  // between chunks, and the next page is simply never emitted. The wake below
  // is the backstop for a page that never reports back.
  const cancelling: InstantEvalProcessState = {
    ...state,
    phase: "cancelling",
    cancelRequestedAtMs: refMs,
    lastActivityAtMs: refMs,
  };

  return { state: cancelling, ...instantEvalWakeFor(cancelling) };
};

/**
 * The run's outcome landed: nothing more is judged, and routed pages that reported after it ended
 * are billed now, so their cost lands on the finished row after the finish set its total.
 */
export const handleInstantEvalFinished: EventHandler<
  InstantEvalProcessState,
  unknown,
  InstantEvalIntents
> = (state, payload, ctx) => {
  const finished: InstantEvalProcessState = {
    ...state,
    phase: "terminal",
    isFinishRecorded: true,
    unbilledLatePages: [],
  };
  if (state.unbilledLatePages.length === 0) return { state: finished, nextWakeAt: null };
  const { runId } = instantEvalProcessEventViewSchema.parse(payload);
  return {
    state: finished,
    nextWakeAt: null,
    intents: state.unbilledLatePages.map((late) => instantEvalBillLatePage({ ctx, runId, late })),
  };
};

export const instantEvalWake: WakeHandler<InstantEvalProcessState, InstantEvalIntents> = (
  state,
  ctx,
) => {
  const runId = ctx.key;
  // A wake for a run nothing ever touched has to clear itself, or the wake
  // worker re-finds it for ever.
  if (state.phase === "terminal" || state.phase === "idle") {
    return { state, nextWakeAt: null };
  }

  if (state.phase === "cancelling") {
    const requestedAtMs = state.cancelRequestedAtMs ?? ctx.now;
    if (ctx.now - requestedAtMs < INSTANT_EVAL_CANCEL_GRACE_MS) {
      return { state, nextWakeAt: requestedAtMs + INSTANT_EVAL_CANCEL_GRACE_MS };
    }

    // The page in flight never reported back. The same message key the normal
    // cancelled path uses, so the outbox dedups if that one did dispatch.
    return {
      state: { ...state, phase: "terminal" },
      nextWakeAt: null,
      intents: [
        ctx.intent("finish", instantEvalFinishKey({ runId, reason: "cancelled" }), {
          runId,
          projectId: ctx.projectId,
          outcome: "cancelled",
          errorCode: null,
          inputTokens: state.inputTokens,
          requests: state.requests,
          costNanoUsd: state.costNanoUsd,
          routedInputTokens: state.routedInputTokens,
        }),
      ],
    };
  }

  if (ctx.now - state.lastActivityAtMs < INSTANT_EVAL_STALL_THRESHOLD_MS) {
    return { state, nextWakeAt: state.lastActivityAtMs + INSTANT_EVAL_STALL_THRESHOLD_MS };
  }

  // The stall is recorded as a durable outcome rather than derived at read
  // time, so a run that stopped says so instead of reading as still running.
  return {
    state: { ...state, phase: "terminal" },
    nextWakeAt: null,
    intents: [
      ctx.intent("finish", instantEvalFinishKey({ runId, reason: "stalled" }), {
        runId,
        projectId: ctx.projectId,
        outcome: "failed",
        errorCode: "instant_eval_stalled",
        inputTokens: state.inputTokens,
        requests: state.requests,
        costNanoUsd: state.costNanoUsd,
        routedInputTokens: state.routedInputTokens,
      }),
    ],
  };
};

/**
 * The view of an event the process is given: ids, counts and nothing else.
 * Built field by field rather than spread, because the default view is the raw
 * event data and `requested` carries the caller's whole statement.
 */
export function buildInstantEvalProcessEventView(
  event: InstantEvalProcessingEvent,
): InstantEvalProcessEventView {
  const data = event.data as Record<string, unknown>;
  const number = (key: string): number => (typeof data[key] === "number" ? data[key] : 0);

  return {
    runId: typeof data.runId === "string" ? data.runId : String(event.aggregateId),
    rowLimit: number("rowLimit"),
    questions: Array.isArray(data.questions) ? data.questions.length : 0,
    total: number("total"),
    pageSize: number("pageSize"),
    keyColumns: Array.isArray(data.keyColumns) ? data.keyColumns.map(String) : [],
    page: number("page"),
    rows: number("rows"),
    failed: number("failed"),
    skipped: number("skipped"),
    inputTokens: number("inputTokens"),
    requests: number("requests"),
    costNanoUsd: number("costNanoUsd"),
    routedInputTokens: number("routedInputTokens"),
    cursor: typeof data.cursor === "string" ? data.cursor : null,
    cursorSpanId: typeof data.cursorSpanId === "string" ? data.cursorSpanId : null,
    hasNextPage: data.hasNextPage === true,
  };
}
