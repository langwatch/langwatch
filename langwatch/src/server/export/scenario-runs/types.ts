import { z } from "zod";

/**
 * How many rows one scenario run becomes.
 *
 * A run is nested — it contains a conversation and a list of judged criteria —
 * and CSV is flat, so each mode picks a different row axis:
 *
 *   summary  — one row per run       → pass rates, cost, duration, trends
 *   criteria — one row per criterion → "which criterion fails most?" (pivot)
 *   full     — one row per message   → read the transcripts
 *
 * All three read the same fetched run, so no mode costs an extra query.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */
export const scenarioRunExportModeSchema = z.enum([
  "summary",
  "criteria",
  "full",
]);
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
