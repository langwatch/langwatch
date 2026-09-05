import { z } from "zod";

import type { TraceSharedFiltersInput } from "./trace-legacy-read.types";

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
 * Everything a download request states EXCEPT which filters it narrows by.
 *
 * The filter selection is the ANALYTICS feature's schema — its keys are that
 * feature's enumerated filter fields, and a trace package may not reach into
 * another feature's server package for them. So the shape is published here
 * without that one key and the process joins the two at the mount, which is
 * the same seam the trace read stack already takes its filter translator
 * across. Stating it as a shape rather than a schema is what makes the join a
 * single spread rather than a second, drifting description of the request.
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
 * A download request, as the export service consumes it.
 *
 * `filters` is typed from the legacy read's own structural restatement rather
 * than from the analytics schema, for the reason above; what a caller may SEND
 * is still checked against the real thing, because the process validates with
 * the joined schema at the transport.
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
