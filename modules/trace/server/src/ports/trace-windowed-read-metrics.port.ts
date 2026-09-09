export type TraceWindowedReadOutcome =
  | "error"
  | "hit"
  | "unbounded_empty"
  | "unbounded_hit"
  | "unwindowed"
  | "windowed_empty"
  | "widened_empty"
  | "widened_hit";

/** Process-owned observability boundary for partition-pruned ClickHouse reads. */
export abstract class TraceWindowedReadMetricsPort {
  abstract record(input: { table: string; outcome: TraceWindowedReadOutcome }): void;
}
