import type { z } from "zod";
import type { sharedFiltersInputSchema } from "~/server/analytics/types";
import type { ProjectionPlan } from "./projection/types";

/**
 * The INPUTS to the legacy trace read.
 *
 * The results the same read answers with live in `@langwatch/trace-contract`
 * (`trace-read.contract.ts`), beside the trace formats they are built from, so
 * a transport can name them without importing this application. The inputs
 * stay here because they are derived from the shared analytics filter schema
 * and the projection plan, neither of which has left the application yet.
 */

/** Time axis that `startDate`/`endDate` and the keyset cursor apply to. */
export type TraceDateField = "occurred" | "updated";

/**
 * Options for getAllTracesForProject, shared by the TraceService facade and the
 * ClickHouse implementation so the contract stays in one place.
 */
export interface GetAllTracesForProjectOptions {
  downloadMode?: boolean;
  includeSpans?: boolean;
  /**
   * Resolve offloaded >64 KB IO from event_log to the FULL value (#4991).
   * Only the download/export path (a content-consuming read) opts in; the
   * list/search grid leaves this false so it keeps the ≤64 KB preview and
   * issues zero event_log SELECTs (#4888 AC2 / ADR-022). Requires
   * `includeSpans: true` to have any effect (resolution runs during span
   * enrichment). No-op unless the TraceService carries blob-resolution deps.
   */
  resolveBlobs?: boolean;
  scrollId?: string | null;
  /**
   * Which time axis the date window + keyset cursor filter on. "occurred"
   * (default) keeps the legacy OccurredAt behavior; "updated" pages by last
   * mutation time for incremental ETL (CDC) pulls.
   */
  dateField?: TraceDateField;
  /**
   * Compiled projection plan (from the projection DSL). Drives which child
   * collections are JOINed and whether the heavy io columns are fetched.
   * Opaque to callers — produced by `compileProjection`.
   */
  projection?: ProjectionPlan;
}

/**
 * Input parameters for getAllTracesForProject.
 * Used by the ClickHouse trace service.
 * Extends the shared filters input schema with pagination and sorting options.
 */
export type GetAllTracesForProjectInput = z.infer<typeof sharedFiltersInputSchema> & {
  // No pageOffset: offset paging was dropped in the ClickHouse migration and
  // the boundary now rejects a non-zero one (#6808). Paging is scrollId only.
  pageSize?: number;
  groupBy?: string;
  sortBy?: string;
  sortDirection?: string;
  scrollId?: string | null;
  updatedAt?: number;
};

/**
 * Input parameters for aggregation queries (getTopicCounts, getCustomersAndLabels).
 */
export type AggregationFiltersInput = z.infer<typeof sharedFiltersInputSchema>;
