import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY } from "@langwatch/experiment-contract";

/**
 * How an experiment run started from CI executes its cells: the server's
 * default (auto), one at a time in row order, or up to a concurrency at once.
 */
export const MAX_RUN_CONCURRENCY = MAX_CONCURRENCY;

export type RunExecution = {
  mode: "auto" | "sequential" | "parallel";
  /** Kept while sequential, so switching back restores it. */
  parallelConcurrency: number;
};

/** The concurrency the run starts with: none on auto, so the server picks; 1 when sequential. */
export function concurrencyOf(execution: RunExecution): number | undefined {
  if (execution.mode === "auto") return undefined;
  return execution.mode === "sequential" ? 1 : execution.parallelConcurrency;
}

/** The picker's first value: the experiment's saved concurrency, else auto. */
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
      : undefined;
  if (saved === undefined) return { mode: "auto", parallelConcurrency: DEFAULT_CONCURRENCY };
  return { mode: saved === 1 ? "sequential" : "parallel", parallelConcurrency: saved };
}
