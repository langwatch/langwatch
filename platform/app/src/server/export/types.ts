import { z } from "zod";
import { sharedFiltersInputSchema } from "~/server/analytics/types";

/**
 * Export mode: "summary" yields one row per trace; "full" yields one row per span.
 */
export const exportModeSchema = z.enum(["summary", "full"]);
export type ExportMode = z.infer<typeof exportModeSchema>;

/**
 * Export format: "csv" (RFC 4180) or "json" (JSONL, one object per line).
 */
export const exportFormatSchema = z.enum(["csv", "json"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

/**
 * Request payload for initiating a trace export.
 *
 * Reuses the shared filter schema for project scoping and time-range filtering.
 * When `traceIds` is provided, the export is scoped to those specific traces
 * (ignoring other filters).
 */
export const exportRequestSchema = z.object({
  projectId: z.string(),
  mode: exportModeSchema,
  format: exportFormatSchema,
  filters: sharedFiltersInputSchema.shape.filters,
  startDate: z.number(),
  endDate: z.number(),
  query: z.string().optional(),
  traceIds: z.array(z.string()).max(10_000).optional(),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

/**
 * Progress snapshot emitted alongside each chunk during streaming export.
 */
export const exportProgressSchema = z.object({
  exported: z.number(),
  total: z.number(),
});
export type ExportProgress = z.infer<typeof exportProgressSchema>;
