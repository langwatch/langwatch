import { z } from "zod";

import type { TraceSharedFiltersInput } from "./trace-legacy-read.types.ts";

/**
 * Export mode: "summary" yields one row per trace; "full" yields one row per
 * span.
 */
export const exportModeSchema = z.enum(["summary", "full"]);
export type ExportMode = z.infer<typeof exportModeSchema>;

/**
 * Export format: "csv" (RFC 4180) or "json" (JSONL, one object per line).
 */
export const exportFormatSchema = z.enum(["csv", "json"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

/**
 * Export request shape, excluding filters (from analytics feature). Published
 * as shape (not schema) so mount-point join is single spread without drift.
 */
export const traceExportRequestShape = {
  projectId: z.string(),
  mode: exportModeSchema,
  format: exportFormatSchema,
  startDate: z.number(),
  endDate: z.number(),
  query: z.string().optional(),
  /**
   * A bounded explicit selection. The cap is what stops one request naming
   * more traces than the read can key on.
   */
  traceIds: z.array(z.string()).max(10_000).optional(),
} as const;

/**
 * A download request, as the export service consumes it. `filters` is typed
 * from the legacy read's restatement, not the analytics schema — a caller's
 * input is still checked against the joined schema at the transport.
 */
export type ExportRequest = {
  projectId: string;
  mode: ExportMode;
  format: ExportFormat;
  filters: TraceSharedFiltersInput["filters"];
  startDate: number;
  endDate: number;
  query?: string | undefined;
  traceIds?: string[] | undefined;
};

/**
 * Progress snapshot emitted alongside each chunk during a streaming export.
 */
export const exportProgressSchema = z.object({
  exported: z.number(),
  total: z.number(),
});
export type ExportProgress = z.infer<typeof exportProgressSchema>;
