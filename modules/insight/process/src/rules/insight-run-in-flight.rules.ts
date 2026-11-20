import type { InsightRunOutcome, InsightRunReason } from "@langwatch/insight-contract";

export interface InsightRunInFlightState {
  /** The last run that started, its conversation and when; null until one started. */
  readonly runId: string | null;
  readonly conversationId: string | null;
  /** Epoch milliseconds. */
  readonly startedAt: number | null;
  /** The last run that settled, started or not, and how it ended; all null until one did. */
  readonly lastSettledRunId: string | null;
  /** Epoch milliseconds. */
  readonly lastRunAt: number | null;
  readonly lastRunOutcome: InsightRunOutcome | null;
  readonly lastRunReason: InsightRunReason | null;
  readonly lastRunFiled: number | null;
  readonly lastRunRenewed: number | null;
  readonly lastRunConversationId: string | null;
  /**
   * The newest run the row took, started or settled, in the run order: its id and its slot, null
   * until it took one, and when it started, null too on a run that did not carry it.
   */
  readonly newestRunId: string | null;
  readonly newestRunSlot: number | null;
  readonly newestRunSince: number | null;
  /** The last settled run's slot and start, in the run order; an older run's outcome leaves it. */
  readonly lastSettledRunSlot: number | null;
  readonly lastSettledRunSince: number | null;
  /** When the last settled run's turn started; null on a run that never started. Epoch ms. */
  readonly lastSettledRunStartedAt: number | null;
  /**
   * The run a newer run's start took the place of before it settled, and when its turn started,
   * so its own outcome still reads its start; null until a start took one's place.
   */
  readonly overtakenRunId: string | null;
  readonly overtakenRunStartedAt: number | null;
}

/** What a schedule with no row reads: no run started, none settled. */
export const NO_RUN_STARTED: InsightRunInFlightState = {
  runId: null,
  conversationId: null,
  startedAt: null,
  lastSettledRunId: null,
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunReason: null,
  lastRunFiled: null,
  lastRunRenewed: null,
  lastRunConversationId: null,
  newestRunId: null,
  newestRunSlot: null,
  newestRunSince: null,
  lastSettledRunSlot: null,
  lastSettledRunSince: null,
  lastSettledRunStartedAt: null,
  overtakenRunId: null,
  overtakenRunStartedAt: null,
};
