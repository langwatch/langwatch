import { DEFAULT_CONCURRENCY } from "@langwatch/experiment-contract";

/**
 * How an experiment run started from CI executes its cells: one at a time in
 * row order, or up to a concurrency at once. The run API accepts 1 to 24.
 */
export const MAX_RUN_CONCURRENCY = 24;

export type RunExecution = {
  mode: "sequential" | "parallel";
  /** Kept while sequential, so switching back restores it. */
  parallelConcurrency: number;
};

/** The concurrency the run starts with: 1 when sequential. */
export function concurrencyOf(execution: RunExecution): number {
  return execution.mode === "sequential" ? 1 : execution.parallelConcurrency;
}

/** The picker's first value: parallel at the experiment's saved concurrency. */
export function initialRunExecution({
  savedConcurrency,
}: {
  savedConcurrency?: number;
}): RunExecution {
  const saved =
    savedConcurrency !== undefined &&
    Number.isInteger(savedConcurrency) &&
    savedConcurrency >= 1 &&
    savedConcurrency <= MAX_RUN_CONCURRENCY
      ? savedConcurrency
      : DEFAULT_CONCURRENCY;
  return { mode: saved === 1 ? "sequential" : "parallel", parallelConcurrency: saved };
}
