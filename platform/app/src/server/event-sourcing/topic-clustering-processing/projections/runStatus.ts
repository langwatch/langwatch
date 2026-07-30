import {
  defineFoldProjection,
  deriveStateVersion,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import { topicClustering } from "../aggregate";
import { runIsNewer } from "../runIdentity";
import {
  type TopicClusteringRunMode,
  type TopicClusteringSkipReason,
  type TopicClusteringTrigger,
  topicClusteringRunModeSchema,
  topicClusteringSkipReasonSchema,
  topicClusteringTriggerSchema,
} from "../schema";

/**
 * `topicClusteringRunStatus` — the per-project read model behind the settings
 * page. It keeps only what it was told about the run it currently considers
 * current and derives the last/in-progress split at read time, so there is no
 * roll-up step to get out of order.
 *
 * Every field is order-invariant by construction: `lastRequestedAt` is
 * last-write-wins on the request's own stamp, `currentRunId` is monotone by run
 * rank, `currentRunPages` is keyed by page so a redelivered page writes the
 * same entry, and `currentRunTerminal` is frozen on first write.
 */

const terminalOutcomeSchema = z.object({
  kind: z.enum(["finished", "failed"]),
  finishedAt: z.number(),
  mode: topicClusteringRunModeSchema.nullable(),
  skippedReason: topicClusteringSkipReasonSchema.nullable(),
  /** Operator-facing only. Never forwarded to a customer surface — only
   * `errorCode`/`isErrorUserActionable` are customer-safe. */
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
  /** Traces processed, keyed by the page that processed them. The total is a
   * query over this, never a running sum a redelivery could double. */
  currentRunPages: z.record(z.string(), z.number()),
  currentRunTerminal: terminalOutcomeSchema.nullable(),
});
export type RunStatusState = z.infer<typeof runStatusStateSchema>;

export function initRunStatusState(): RunStatusState {
  return {
    lastRequestedAt: null,
    lastRequestTrigger: null,
    currentRunId: null,
    currentRunPages: {},
    currentRunTerminal: null,
  };
}

function tracesProcessed(pages: Record<string, number>): number {
  return Object.values(pages).reduce((total, traces) => total + traces, 0);
}

/**
 * Routes a run's event onto `currentRunId`, clearing the page set when — and
 * only when — the event's run is newer by rank than whatever is already
 * current. An event for an older run is a stale straggler: the newer run
 * already owns the row.
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
      currentRunPages: {},
      currentRunTerminal: null,
    });
  }
  if (runId === state.currentRunId) return mutate(state);
  return state;
}

export const topicClusteringRunStatus = defineFoldProjection({
  name: "topicClusteringRunStatus",
  aggregate: topicClustering,
  version: deriveStateVersion(runStatusStateSchema),
  init: initRunStatusState,
  handle: {
    requested: (state, data) => {
      // An older or simultaneous request observed after a newer one carries no
      // new information for this pair of fields.
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

    runStarted: (state, data) =>
      withCurrentRun(state, data.runId, (current) => current),

    runCompleted: (state, data) =>
      withCurrentRun(state, data.runId, (current) => {
        const currentRunPages = {
          ...current.currentRunPages,
          [data.page]: data.tracesProcessed,
        };
        if (data.nextSearchAfter !== undefined) {
          return { ...current, currentRunPages };
        }
        return {
          ...current,
          currentRunPages,
          // A run has at most one terminal event in practice; freezing the
          // first keeps the field well-defined if that ever stops holding.
          currentRunTerminal: current.currentRunTerminal ?? {
            kind: "finished",
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
      }),

    runFailed: (state, data) =>
      withCurrentRun(state, data.runId, (current) => ({
        ...current,
        currentRunTerminal: current.currentRunTerminal ?? {
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
      })),
  },
});

export interface RunStatusView {
  readonly lastRequestedAt: number | null;
  readonly lastRequestTrigger: TopicClusteringTrigger | null;
  readonly isRunInProgress: boolean;
  readonly inProgressRunId: string | null;
  /** The current run's outcome, or null until it has one. An older,
   * superseded run's outcome is not "the last run". */
  readonly lastRun: {
    readonly runId: string;
    readonly outcome: "completed" | "skipped" | "failed";
    readonly finishedAt: number;
    readonly mode: TopicClusteringRunMode | null;
    readonly skippedReason: TopicClusteringSkipReason | null;
    readonly errorCode: string | null;
    readonly isErrorUserActionable: boolean;
    /** Zeroed for a failed run, which produced no usable counts. */
    readonly tracesProcessed: number;
    readonly topicsCount: number;
    readonly subtopicsCount: number;
    readonly pages: number;
  } | null;
}

export function deriveRunStatusView(state: RunStatusState): RunStatusView {
  const terminal = state.currentRunTerminal;
  const traces = tracesProcessed(state.currentRunPages);
  const failed = terminal?.kind === "failed";
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
            outcome: failed
              ? "failed"
              : terminal.skippedReason !== null && traces === 0
                ? "skipped"
                : "completed",
            finishedAt: terminal.finishedAt,
            mode: terminal.mode,
            skippedReason: terminal.skippedReason,
            errorCode: terminal.errorCode,
            isErrorUserActionable: terminal.isErrorUserActionable,
            tracesProcessed: failed ? 0 : traces,
            topicsCount: failed ? 0 : terminal.topicsCount,
            subtopicsCount: failed ? 0 : terminal.subtopicsCount,
            pages: failed ? 0 : Object.keys(state.currentRunPages).length,
          },
  };
}
