/**
 * Simulation's boundary to the shared partition-window read policy.
 *
 * The feature chooses when it can use a partition hint. Application
 * composition supplies the shared policy and its telemetry implementation.
 */
export type SimulationWindowFragment = {
  fromMs: number;
  toMs: number;
  params: { fromMs: number; toMs: number };
  sqlFor(column: string): string;
};

export type SimulationWindowFallback = "unbounded" | "none" | { lookbackMs: number };

export type SimulationWindowedReadInput<Result> = {
  table: string;
  hintMs: number | null;
  windowMs?: number;
  fallback: SimulationWindowFallback;
  isEmpty(result: Result): boolean;
  run(window: SimulationWindowFragment | null): Promise<Result>;
};

/** Application adapter for the shared query-window and telemetry policy. */
export abstract class SimulationWindowedRead {
  abstract query<Result>(input: SimulationWindowedReadInput<Result>): Promise<Result>;
}
