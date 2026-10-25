import type { MonitorErrorRateCounts } from "../rules/monitor-error-rate.rules.ts";

/** One revision of one monitor: a change to the monitor starts its counts again. */
export type MonitorRevisionKey = Readonly<{
  projectId: string;
  monitorId: string;
  /** The monitor's `updatedAt`, in epoch milliseconds. */
  monitorRevision: number;
}>;

/**
 * The rolling counts of an on-message monitor's settled runs, shared by every worker.
 * Spec: modules/evaluation/specs/monitor-error-rate.feature
 */
export interface MonitorErrorRateRepository {
  /** Counts one settled run at `now` and answers the window's counts, this run included. */
  record(
    input: MonitorRevisionKey & {
      outcome: "processed" | "error";
      /** The normalized message, counted only for an error. */
      errorMessage?: string;
      now: number;
    },
  ): Promise<MonitorErrorRateCounts>;
  /** This revision's error messages, the most counted first; empty when none errored. */
  findTopErrors(input: MonitorRevisionKey): Promise<string[]>;
  /** Claims the single report of this revision: true for the first caller only. */
  claimReport(input: MonitorRevisionKey): Promise<boolean>;
  /** Gives the claim back when the report could not be recorded. */
  releaseReport(input: MonitorRevisionKey): Promise<void>;
}
