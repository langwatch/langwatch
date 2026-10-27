import type { Named } from "@langwatch/module";
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

const scenarioRunExportRequestSchemaDefinition = z.object({
  projectId: z.string(),
  mode: scenarioRunExportModeSchema,
  /** Scopes to one scenario set; omitted when exporting from "All Runs". */
  scenarioSetId: z.string().optional(),
  scenarioId: z.string().optional(),
  passFailStatus: scenarioRunExportStatusFilterSchema.optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
});
export interface ScenarioRunExportRequestSchema extends Named<
  typeof scenarioRunExportRequestSchemaDefinition
> {}
export const scenarioRunExportRequestSchema: ScenarioRunExportRequestSchema =
  scenarioRunExportRequestSchemaDefinition;
export type ScenarioRunExportRequest = z.infer<typeof scenarioRunExportRequestSchema>;

/** The export application opens one download for an authenticated person. */
export type ScenarioRunExportDownloadInput = Readonly<{
  request: ScenarioRunExportRequest;
  userId: string;
  signal?: AbortSignal;
}>;

/** A byte stream the REST door writes without buffering a complete CSV. */
export type ScenarioRunExportDownload = Readonly<{
  exportId: string;
  filename: string;
  totalCount: number;
  stream: AsyncIterable<Uint8Array>;
  cancel: (reason: unknown) => Promise<void>;
}>;

/**
 * Progress is counted in runs *visited*, not rows written: a criteria-mode
 * export emits several rows per run, and a category filter drops some runs
 * entirely, so only runs-visited can compare against a total known up front.
 */
const scenarioRunExportProgressSchemaDefinition = z.object({
  exported: z.number(),
  total: z.number(),
});
export interface ScenarioRunExportProgressSchema extends Named<
  typeof scenarioRunExportProgressSchemaDefinition
> {}
export const scenarioRunExportProgressSchema: ScenarioRunExportProgressSchema =
  scenarioRunExportProgressSchemaDefinition;
export type ScenarioRunExportProgress = z.infer<typeof scenarioRunExportProgressSchema>;
