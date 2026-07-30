import { z } from "zod";

/**
 * Status values stored in ClickHouse.
 *
 * `STALLED` is one of them: it used to be derived per read and never written,
 * so the stored status and the displayed status disagreed by design. Since
 * ADR-103 the `scenarioExecution` process writes it when a run's
 * deadline fires.
 */
const SIMULATION_RUN_STATUS = [
  "PENDING",
  "IN_PROGRESS",
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "STALLED",
] as const;
export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUS)[number];

/**
 * Verdict values stored in ClickHouse.
 * Lowercase, matching the Verdict enum string values.
 */
const SIMULATION_VERDICT = ["success", "failure", "inconclusive"] as const;
export type SimulationVerdict = (typeof SIMULATION_VERDICT)[number];

export const simulationMessageSchema = z
  .object({
    trace_id: z.string().optional(),
  })
  .passthrough();

export const simulationResultsSchema = z.object({
  verdict: z.enum(SIMULATION_VERDICT),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()).default([]),
  unmetCriteria: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type SimulationResults = z.infer<typeof simulationResultsSchema>;

/**
 * Where a run sits, carried on the events that are not the run's first.
 *
 * `queued` and `started` have always carried the full identity set. The rest of
 * a run's events did not, which was fine while the only consumer was a fold
 * keyed on the run — but an event-only subscriber has no fold to read them from,
 * and pushing an update without a set id makes the set-filtered panels stop
 * matching it.
 *
 * Optional and additive, with NO version bump: the version is asserted with
 * `z.literal`, so bumping it would stop every already-committed event of these
 * types from parsing. Absent means "an event written before this shipped", which
 * a consumer treats exactly as it treated every such event before.
 *
 * Lives here rather than in `events.ts` because the command declarations in
 * `commands.ts` describe the same placement and must not drift from it.
 */
export const runPlacementFields = {
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
};
