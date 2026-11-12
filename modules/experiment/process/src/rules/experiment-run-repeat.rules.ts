/**
 * A repeated run lays its rows out dataset row by dataset row: run row `r * repeat + k` is
 * repetition `k` of dataset row `r`, so a reader finds the dataset row from the index alone.
 * @see specs/experiments-v3/run-repeat.feature
 */
import type { ExecutionScope } from "@langwatch/experiment-contract";

/** The run's rows: every dataset row `repeat` times in a row. */
export function repeatedRows<T>({ rows, repeat }: { rows: readonly T[]; repeat: number }): T[] {
  return rows.flatMap((row) => Array.from({ length: repeat }, () => row));
}

/** Every run row of each dataset row a scope names. */
function repeatedIndices({ indices, repeat }: { indices: number[]; repeat: number }): number[] {
  return indices.flatMap((index) =>
    Array.from({ length: repeat }, (_, repetition) => index * repeat + repetition),
  );
}

/** The scope over the repeated rows: a row it names becomes all of that row's repetitions. */
export function repeatedScope({
  scope,
  repeat,
}: {
  scope: ExecutionScope;
  repeat: number;
}): ExecutionScope {
  switch (scope.type) {
    case "rows":
      return { type: "rows", rowIndices: repeatedIndices({ indices: scope.rowIndices, repeat }) };
    case "target-rows":
      return scope.rowIndices
        ? { ...scope, rowIndices: repeatedIndices({ indices: scope.rowIndices, repeat }) }
        : scope;
    default:
      return scope;
  }
}

/** How many times a run asked to repeat every row: 1 when it asked for no repeat. */
export function runRepeatOf(repeat: number | undefined): number {
  return repeat !== undefined && repeat > 1 ? repeat : 1;
}
