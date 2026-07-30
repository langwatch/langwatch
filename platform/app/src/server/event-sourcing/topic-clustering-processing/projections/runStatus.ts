import type { AggregateEvent } from "@langwatch/event-sourcing";
import { z } from "zod";
import {
  type TopicClusteringEventKey,
  topicClusteringEventKeyOf,
} from "../aggregate";
import { runIsNewer } from "../runIdentity";
import {
  type RequestedData,
  type RunCompletedData,
  type RunFailedData,
  type RunStartedData,
  type TopicClusteringRunMode,
  type TopicClusteringSkipReason,
  type TopicClusteringTrigger,
  topicClusteringRunModeSchema,
  topicClusteringSkipReasonSchema,
  topicClusteringTriggerSchema,
} from "../schema";

/**
 * `topicClusteringRunStatus` — the public read model behind the settings
 * page (ADR-098): per-project last-request and last/current-run facts. One
 * row per project.
 *
 * === Why this state shape differs from the old fold ===
 *
 * The old `TopicClusteringRunStatusData` stored a flat "Last*" / "InProgress*"
 * pair and rolled the in-progress half into the last-run half the moment a
 * terminal event was applied — a roll-up performed as a STATE MUTATION, done
 * once, at apply time. That is not order-invariant: if a run's terminal page
 * happened to be delivered before an earlier, still-in-flight page of the
 * SAME run (both legal under ADR-098's best-effort ordering), the roll-up
 * would fire on the terminal page and the later-applied earlier page would
 * then try to re-open a run the row had already reported as finished — or,
 * worse, a stale page from a SUPERSEDED run arriving late would be accepted
 * as a fresh "now in progress" run, because the old fold tested
 * `InProgressRunId === event.data.runId` (arrival equality) rather than
 * "is this run actually newer".
 *
 * This fold instead stores ONLY the facts about "the run this row currently
 * considers current" — accumulated commutatively — and DERIVES the
 * last/in-progress split at read time ({@link deriveRunStatusView}). There is
 * no roll-up step to get out of order, because there is no separate "last"
 * half to roll into.
 *
 * === Field-by-field order-invariance classification (ADR-098 decision 4) ===
 *
 * - `lastRequestedAt` / `lastRequestTrigger` — **last-write-wins by time**,
 *   ordered on the `requested` event's own `occurredAt` (these events are
 *   minted by our own server, not customer telemetry — see `schema.ts`'s
 *   module docblock for why that value is trustworthy as an ordering stamp
 *   here), tie-broken by "keep the existing value" (a tie cannot carry new
 *   information). `lastRequestedAt` is its own stamp: there is no separate
 *   `asOf` column because the field being ordered IS the timestamp.
 * - `currentRunId` — **monotone by rank**, via {@link runIsNewer}: a run
 *   only becomes "current" if it is not older, by rank, than whatever is
 *   already current. `status = max(current, incoming)` over the lattice
 *   ADR-098 decision 4 names explicitly, with "the run's own minted instant"
 *   as the rank instead of a hand-maintained counter.
 * - `currentRunTracesSeen` / `currentRunPagesSeen` — **commutative and
 *   associative**: each is a sum/count over the DISTINCT page events
 *   belonging to the current run. Summing distinct contributions is
 *   order-invariant by algebra; double-application is a separate concern
 *   the fold executor's delivery-sequence guard already rules out
 *   (ADR-098 decision 5), not something this fold has to guard itself. Both
 *   reset — not merely stop advancing — the moment a strictly newer run
 *   becomes current, which is what keeps them from silently carrying a
 *   stale run's partial counts into a fresh one's total regardless of which
 *   run's pages a fold instance happens to see first.
 * - `currentRunTerminal` — **monotone "sticky-once"**: null until the first
 *   terminal event (a `runCompleted` with no `nextSearchAfter`, or a
 *   `runFailed`) for the current run is applied, and never overwritten
 *   after that. In real operation at most one terminal event exists per
 *   run — the process manager only ever calls ONE of
 *   `recordClusteringRunCompleted`/`recordClusteringRunFailed` per page —
 *   so this degenerates to a plain assignment; the sticky guard is
 *   defensive, not load-bearing, and is what makes the field well-defined
 *   even under a hypothetical duplicate terminal delivery from two
 *   different code paths. **Documented exception:** if a single run ever
 *   produced BOTH a completion and a failure (an operational impossibility
 *   this fold does not itself enforce), which one sticks would genuinely
 *   depend on delivery order — `runStatus.unit.test.ts`'s "is
 *   order-dependent ONLY for the operationally-impossible case..." test
 *   pins this boundary rather than hiding it.
 *
 * No field here reads `occurredAt` as a partition/version/last-write-wins
 * column on a ClickHouse table (ADR-099's prohibition) — these are in-memory
 * fold-state comparisons, not ClickHouse structural roles; see `tables.ts`
 * for the table's own, separate `AcceptedAt`/`UpdatedAt` roles.
 */

const terminalOutcomeSchema = z.object({
  kind: z.enum(["completed", "skipped", "failed"]),
  finishedAt: z.number(),
  mode: topicClusteringRunModeSchema.nullable(),
  skippedReason: topicClusteringSkipReasonSchema.nullable(),
  /** Raw failure text — operator-facing only. Never forwarded to the
   * run-history read model (`runHistory.ts`'s docblock) or to a customer
   * surface; only `errorCode`/`isErrorUserActionable` are customer-safe. */
  errorMessage: z.string().nullable(),
  errorCode: z.string().nullable(),
  isErrorUserActionable: z.boolean(),
  topicsCount: z.number(),
  subtopicsCount: z.number(),
});
export type TerminalOutcome = z.infer<typeof terminalOutcomeSchema>;

export const runStatusStateSchema = z.object({
  lastRequestedAt: z.number().nullable(),
  lastRequestTrigger: topicClusteringTriggerSchema.nullable(),
  currentRunId: z.string().nullable(),
  currentRunTracesSeen: z.number(),
  currentRunPagesSeen: z.number(),
  currentRunTerminal: terminalOutcomeSchema.nullable(),
});
export type RunStatusState = z.infer<typeof runStatusStateSchema>;

export function initRunStatusState(): RunStatusState {
  return {
    lastRequestedAt: null,
    lastRequestTrigger: null,
    currentRunId: null,
    currentRunTracesSeen: 0,
    currentRunPagesSeen: 0,
    currentRunTerminal: null,
  };
}

/**
 * Routes a page/run event onto `currentRunId`, resetting the accumulator
 * when — and only when — the event's run is genuinely newer by rank than
 * whatever is already current. An event for an older run is a stale
 * straggler and is dropped entirely: the newer run already owns the row,
 * and letting a late arrival touch `currentRun*` is exactly the
 * order-dependency this rewrite closes (see the module docblock).
 */
function withCurrentRun(
  state: RunStatusState,
  runId: string,
  mutate: (state: RunStatusState) => RunStatusState,
): RunStatusState {
  if (state.currentRunId === null || runIsNewer(runId, state.currentRunId)) {
    return mutate({
      ...state,
      currentRunId: runId,
      currentRunTracesSeen: 0,
      currentRunPagesSeen: 0,
      currentRunTerminal: null,
    });
  }
  if (runId === state.currentRunId) {
    return mutate(state);
  }
  return state;
}

/**
 * Dispatch table keyed by {@link TopicClusteringEventKey} — `keyof
 * typeof topicClustering.events` — rather than a hand-reconstructed
 * `` `topic_clustering/${key}` `` literal per case (`aggregate.ts`'s
 * `topicClusteringEventKeyOf` docblock explains why: a rename in
 * `aggregate.ts` must be a compile error here, not a dispatch table
 * silently going stale). Each handler's own parameter type is the exact
 * event-data shape `aggregate.ts` declares for that key
 * (`RequestedData`/`RunStartedData`/`RunCompletedData`/`RunFailedData`,
 * imported from `../schema` — never a locally re-typed duplicate of the
 * same shape), cast once at the handler boundary the same way
 * `experiment-run-processing/projection.ts`'s `ITEM_HANDLERS` does.
 */
type Handler = (state: RunStatusState, data: unknown) => RunStatusState;

const HANDLERS: Partial<Record<TopicClusteringEventKey, Handler>> = {
  requested: (state, rawData) => {
    const data = rawData as RequestedData;
    // Last-write-wins on the event's own occurredAt: an older or
    // simultaneous request observed after a newer one has already applied
    // carries no new information for this pair of fields.
    if (
      state.lastRequestedAt !== null &&
      state.lastRequestedAt >= data.occurredAt
    ) {
      return state;
    }
    return {
      ...state,
      lastRequestedAt: data.occurredAt,
      lastRequestTrigger: data.trigger,
    };
  },

  runStarted: (state, rawData) => {
    const data = rawData as RunStartedData;
    // Only ever establishes/refreshes `currentRunId`; nothing else to
    // change here — the accumulator is owned entirely by runCompleted.
    return withCurrentRun(state, data.runId, (s) => s);
  },

  runCompleted: (state, rawData) => {
    const data = rawData as RunCompletedData;
    return withCurrentRun(state, data.runId, (s) => {
      const tracesSeen = s.currentRunTracesSeen + data.tracesProcessed;
      const pagesSeen = s.currentRunPagesSeen + 1;
      const isTerminalPage = data.nextSearchAfter === undefined;
      if (!isTerminalPage) {
        return {
          ...s,
          currentRunTracesSeen: tracesSeen,
          currentRunPagesSeen: pagesSeen,
        };
      }
      const skippedWithoutWork = data.skippedReason != null && tracesSeen === 0;
      return {
        ...s,
        currentRunTracesSeen: tracesSeen,
        currentRunPagesSeen: pagesSeen,
        // Sticky: a run has at most one terminal event in practice, but
        // never let a second one overwrite the first if it ever happened.
        currentRunTerminal: s.currentRunTerminal ?? {
          kind: skippedWithoutWork ? "skipped" : "completed",
          finishedAt: data.occurredAt,
          mode: data.mode,
          skippedReason: data.skippedReason ?? null,
          errorMessage: null,
          errorCode: null,
          isErrorUserActionable: false,
          topicsCount: data.topicsCount,
          subtopicsCount: data.subtopicsCount,
        },
      };
    });
  },

  runFailed: (state, rawData) => {
    const data = rawData as RunFailedData;
    return withCurrentRun(state, data.runId, (s) => ({
      ...s,
      currentRunTerminal: s.currentRunTerminal ?? {
        kind: "failed",
        finishedAt: data.occurredAt,
        mode: null,
        skippedReason: null,
        errorMessage: data.error,
        errorCode: data.errorCode ?? null,
        isErrorUserActionable: data.isUserActionable ?? false,
        topicsCount: 0,
        subtopicsCount: 0,
      },
    }));
  },
};

export function applyRunStatusEvent(
  state: RunStatusState,
  event: AggregateEvent,
): RunStatusState {
  const key = topicClusteringEventKeyOf(event.type);
  const handler = key ? HANDLERS[key] : undefined;
  return handler ? handler(state, event.data) : state;
}

/** The settings-page-facing view, derived from stored state rather than
 * stored redundantly — see the module docblock for why. */
export interface RunStatusView {
  readonly lastRequestedAt: number | null;
  readonly lastRequestTrigger: TopicClusteringTrigger | null;
  readonly isRunInProgress: boolean;
  readonly inProgressRunId: string | null;
  /** Null until the current run has a terminal outcome, or there has never
   * been a run. Reflects the CURRENT run only — an older, superseded run's
   * outcome is not "the last run" once a newer one has started, matching
   * `runHistory.ts`'s abandonment rule. */
  readonly lastRun: {
    readonly runId: string;
    readonly outcome: "completed" | "skipped" | "failed";
    readonly finishedAt: number;
    readonly mode: TopicClusteringRunMode | null;
    readonly skippedReason: TopicClusteringSkipReason | null;
    readonly errorCode: string | null;
    readonly isErrorUserActionable: boolean;
    /** Zeroed for a failed run — a failed run produced no usable counts,
     * mirroring the old fold's explicit reset so the settings page never
     * renders a failure alongside a healthy-looking trace/topic count. */
    readonly tracesProcessed: number;
    readonly topicsCount: number;
    readonly subtopicsCount: number;
    readonly pages: number;
  } | null;
}

export function deriveRunStatusView(state: RunStatusState): RunStatusView {
  const terminal = state.currentRunTerminal;
  return {
    lastRequestedAt: state.lastRequestedAt,
    lastRequestTrigger: state.lastRequestTrigger,
    isRunInProgress: state.currentRunId !== null && terminal === null,
    inProgressRunId: terminal === null ? state.currentRunId : null,
    lastRun:
      state.currentRunId === null || terminal === null
        ? null
        : {
            runId: state.currentRunId,
            outcome: terminal.kind,
            finishedAt: terminal.finishedAt,
            mode: terminal.mode,
            skippedReason: terminal.skippedReason,
            errorCode: terminal.errorCode,
            isErrorUserActionable: terminal.isErrorUserActionable,
            tracesProcessed:
              terminal.kind === "failed" ? 0 : state.currentRunTracesSeen,
            topicsCount: terminal.kind === "failed" ? 0 : terminal.topicsCount,
            subtopicsCount:
              terminal.kind === "failed" ? 0 : terminal.subtopicsCount,
            pages: terminal.kind === "failed" ? 0 : state.currentRunPagesSeen,
          },
  };
}
