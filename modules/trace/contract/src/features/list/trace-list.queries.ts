import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { Protections } from "../../trace-viewer-protections.contract.ts";
import type { ResolvedInstantEvalRun } from "../evaluation/trace-instant-eval-chips.ts";

/**
 * Projected fields required by the trace-list read and mapper. This is deliberately separate
 * from the ingest fold state: the list query owns a read-only projection of `trace_summaries`
 * and never exposes Prisma or raw ClickHouse rows.
 */
export interface TraceListSummary {
  traceId: string;
  spanCount: number;
  totalDurationMs: number;
  computedIOSchemaVersion: string;
  computedInput: string | null;
  computedOutput: string | null;
  timeToFirstTokenMs: number | null;
  timeToLastTokenMs: number | null;
  tokensPerSecond: number | null;
  containsErrorStatus: boolean;
  containsOKStatus: boolean;
  errorMessage: string | null;
  models: string[];
  totalCost: number | null;
  nonBilledCost: number | null;
  tokensEstimated: boolean;
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;
  outputFromRootSpan: boolean;
  outputSpanEndTimeMs: number;
  blockedByGuardrail: boolean;
  rootSpanType: string | null;
  containsAi: boolean;
  containsPrompt: boolean;
  selectedPromptId: string | null;
  selectedPromptSpanId: string | null;
  selectedPromptStartTimeMs: number | null;
  lastUsedPromptId: string | null;
  lastUsedPromptVersionNumber: number | null;
  lastUsedPromptVersionId: string | null;
  lastUsedPromptSpanId: string | null;
  lastUsedPromptStartTimeMs: number | null;
  topicId: string | null;
  subTopicId: string | null;
  annotationIds: string[];
  sizeBytes?: number;
  attributes: Record<string, string>;
  traceName: string;
  storageAnchorMs?: number;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
  redactedByVisibilityWindow?: boolean;
}

export interface TraceListFacetQuery {
  sql: string;
  params: Record<string, unknown>;
  settings?: Record<string, string>;
}

export type TraceListSortColumn =
  | "OccurredAt"
  | "TotalDurationMs"
  | "TotalCost"
  | "SpanCount"
  | "TotalTokens"
  | "TimeToFirstTokenMs"
  | "TotalPromptTokenCount"
  | "TotalCompletionTokenCount"
  // MATERIALIZED `_size_bytes` column (see migration 00032). SELECT/ORDER BY
  // only — never inserted.
  | "_size_bytes";

export interface TraceListSort {
  column: TraceListSortColumn;
  direction: "asc" | "desc";
}

/**
 * Keyset cursor: the repository normalizes the sort value to a finite number; tenant and trace id
 * together break ties, since two tenants of an aggregate may hold the same trace id (ADR-177).
 */
const traceListCursorSchemaDefinition = z.object({
  sortValue: z.number(),
  tenantId: z.string(),
  traceId: z.string(),
});
export interface TraceListCursorSchema extends Named<typeof traceListCursorSchemaDefinition> {}
export const traceListCursorSchema: TraceListCursorSchema = traceListCursorSchemaDefinition;

export type TraceListCursor = z.infer<typeof traceListCursorSchema>;

/** A listed trace with the tenant it was read from, which names it on an aggregate. */
export type TraceListRow = TraceListSummary & { tenantId: string };

/** One trace, named by the tenant that holds it and its id. */
export type TraceRef = { tenantId: string; traceId: string };

/**
 * A trace query language filter as written, which trace compiles inside the read that runs it
 * (ADR-202 Decided 25). `hideExplorerOrigins` leaves the Explorer's hidden origins out unless
 * the query names one, as the Explorer's own reads do.
 */
export interface TraceListFilter {
  query: string;
  /** The project the query was written in, whose kind decides the hidden origins. */
  tenantId: string;
  /** The Instant Eval runs registered for the query's `eval` chips. */
  evalRuns?: readonly ResolvedInstantEvalRun[];
  /** The viewer's; under any content protection free text skips captured I/O. */
  protections?: Protections;
  hideExplorerOrigins?: boolean;
}

/**
 * One page as the REPOSITORY answers it: the stored summary rows and the total. Distinct from
 * `TraceListPage` in `trace-list-view`, which is the page the LIST VIEW publishes — rows mapped
 * to `TraceListItem`, evaluations joined on, and a keyset cursor.
 */
export interface TraceListRepositoryPage {
  rows: TraceListRow[];
  totalHits: number;
}

/**
 * Optional per-value aggregates the evaluator facet attaches alongside its row counts so the
 * sidebar drilldown can render verdict pills and a score range slider inline without firing a
 * second query per evaluator. Other facets leave this absent.
 */
const facetValueAggregatesSchemaDefinition = z.object({
  passedCount: z.number(),
  failedCount: z.number(),
  erroredCount: z.number(),
  scoreMin: z.number().nullable(),
  scoreMax: z.number().nullable(),
  hasScore: z.boolean(),
  /** Distinct non-null score values — lets the drilldown suppress a score
   *  slider that is degenerate (constant, or binary 0/1 mirroring pass/fail). */
  distinctScores: z.number(),
  hasLabel: z.boolean(),
  /** Top distinct emitted-label values + counts (capped server-side). Drives
   *  the drilldown's clickable label-filter rows. Absent when none emitted. */
  labelValues: z.array(z.object({ value: z.string(), count: z.number() })).optional(),
});
export interface FacetValueAggregatesSchema extends Named<
  typeof facetValueAggregatesSchemaDefinition
> {}
export const facetValueAggregatesSchema: FacetValueAggregatesSchema =
  facetValueAggregatesSchemaDefinition;

type FacetValueAggregates = z.infer<typeof facetValueAggregatesSchema>;

/**
 * Per-event-name metric value tallies the event facet attaches so its sidebar drilldown
 * (thumbs_up_down → vote values) renders from the discover payload without a second query.
 */
const eventMetricValuesSchemaDefinition = z.object({
  /** Full storage key, e.g. `event.metrics.vote` — the UI strips the
   *  prefix for display but filters on the full key. */
  key: z.string(),
  values: z.array(z.object({ value: z.string(), count: z.number() })),
});
export interface EventMetricValuesSchema extends Named<typeof eventMetricValuesSchemaDefinition> {}
export const eventMetricValuesSchema: EventMetricValuesSchema = eventMetricValuesSchemaDefinition;

export type EventMetricValues = z.infer<typeof eventMetricValuesSchema>;

export interface CategoricalFacetResult {
  values: {
    value: string;
    label?: string;
    count: number;
    aggregates?: FacetValueAggregates;
    /** Set only by the event facet — see {@link EventMetricValues}. */
    eventMetrics?: EventMetricValues[];
  }[];
  totalDistinct: number;
}

export interface DiscreteFacetResult {
  /** Distinct integer values present, ascending, capped by the caller's limit. */
  values: { value: number; count: number }[];
  /** True distinct count (independent of the value cap) — the sidebar uses
   *  this to fall back to the slider above the discrete threshold. */
  distinctCount: number;
}

export type FacetTableName = "trace_summaries" | "evaluation_runs" | "stored_spans";

export interface BatchedFacetResult {
  categoricals: Record<string, CategoricalFacetResult>;
  ranges: Record<string, { min: number; max: number }>;
}

/**
 * Position-based reads are limited by depth (ClickHouse charges for skipped rows),
 * but keyset cursor reads pay nothing. Shared so service and pagination UI agree.
 */
export const TRACE_LIST_MAX_OFFSET_ROWS = 100_000;
