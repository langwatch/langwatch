import { z } from "zod/v4";

/**
 * How many rows one scenario run becomes.
 *
 * A run is nested — it contains a conversation and a list of judged criteria —
 * and CSV is flat, so each mode picks a different row axis:
 *
 *   full     — one row per message   → everything; the complete export
 *   criteria — one row per criterion → "which criterion fails most?" (pivot)
 *
 * Both read the same fetched run, so neither costs an extra query.
 *
 * There is deliberately no one-row-per-run mode. Full already denormalizes
 * every run field onto every message row, so de-duplicating on
 * `run_scenario_run_id` yields exactly that — and gzip makes the larger file
 * cheaper to move than the per-run one was uncompressed. A third mode would
 * have been a third public column contract for data already present.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */
export const scenarioRunExportModeSchema = z.enum(["full", "criteria"]);
export type ScenarioRunExportMode = z.infer<typeof scenarioRunExportModeSchema>;

/**
 * Pass/fail filter, using the same values the run history dropdown emits so a
 * filtered export matches the filtered list exactly.
 */
export const scenarioRunExportStatusFilterSchema = z.enum([
  "pass",
  "fail",
  "stalled",
]);
export type ScenarioRunExportStatusFilter = z.infer<
  typeof scenarioRunExportStatusFilterSchema
>;

export const scenarioRunExportRequestSchema = z.object({
  projectId: z.string(),
  mode: scenarioRunExportModeSchema,
  /** Scopes to one scenario set; omitted when exporting from "All Runs". */
  scenarioSetId: z.string().optional(),
  scenarioId: z.string().optional(),
  passFailStatus: scenarioRunExportStatusFilterSchema.optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
});
export type ScenarioRunExportRequest = z.infer<
  typeof scenarioRunExportRequestSchema
>;

/**
 * Progress is counted in runs *visited*, not rows written. A criteria-mode
 * export emits several rows per run and a category filter drops some runs
 * entirely, so rows-written can never be compared against a total known up
 * front — runs visited can.
 */
export const scenarioRunExportProgressSchema = z.object({
  exported: z.number(),
  total: z.number(),
});
export type ScenarioRunExportProgress = z.infer<
  typeof scenarioRunExportProgressSchema
>;
