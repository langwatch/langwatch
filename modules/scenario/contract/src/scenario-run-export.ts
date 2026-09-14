import { z } from "zod";

/**
 * CSV export modes: full (row per message) or criteria (row per criterion).
 * No one-row-per-run mode as full already denormalizes all fields per row.
 */
export const scenarioRunExportModeSchema = z.enum(["full", "criteria"]);
export type ScenarioRunExportMode = z.infer<typeof scenarioRunExportModeSchema>;

/**
 * Pass/fail filter, using the same values the run history dropdown emits so a
 * filtered export matches the filtered list exactly.
 */
export const scenarioRunExportStatusFilterSchema = z.enum(["pass", "fail", "stalled"]);
export type ScenarioRunExportStatusFilter = z.infer<typeof scenarioRunExportStatusFilterSchema>;

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
export type ScenarioRunExportRequest = z.infer<typeof scenarioRunExportRequestSchema>;

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
export type ScenarioRunExportProgress = z.infer<typeof scenarioRunExportProgressSchema>;
