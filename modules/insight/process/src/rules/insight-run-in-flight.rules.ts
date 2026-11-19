export interface InsightRunInFlightState {
  /** The last run that started, its conversation and when; null until one started. */
  readonly runId: string | null;
  readonly conversationId: string | null;
  /** Epoch milliseconds. */
  readonly startedAt: number | null;
  /** The last run that settled, started or not; null until one did. */
  readonly lastSettledRunId: string | null;
}

/** What a schedule with no row reads: no run started, none settled. */
export const NO_RUN_STARTED: InsightRunInFlightState = {
  runId: null,
  conversationId: null,
  startedAt: null,
  lastSettledRunId: null,
};
