/**
 * Traces procedures, declared once. Anonymous reads are in sharedTrace (ADR-057).
 * Filter/list shapes back v1 REST and analytics; getSampleTraces stays on the API
 * until Evaluation exposes a precondition engine.
 */
import { sharedFiltersInputSchema } from "@langwatch/analytics-contract";
import { defineTrpcContract } from "@langwatch/api/contract";
import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

import {
  customersAndLabelsResultSchema,
  distinctFieldNamesResultSchema,
  namedTopicCountsSchema,
  tracesForProjectResultSchema,
} from "./trace-read.contract.ts";
import { evaluationSchema, traceSchema } from "./trace-format.schemas.ts";

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * tier-effective value (free 1000 / paid 2000 / enterprise 4000) is enforced
 * where the organization's plan is known, in the trace application.
 */
const TRACES_PAGE_SIZE_MAX = resolveRequestBound("tracesPageSizeMax", "ENTERPRISE");
const TRACE_IDS_MAX = resolveRequestBound("traceIdsMax", "ENTERPRISE");

/**
 * Offset pagination was dropped for ClickHouse (deep OFFSET degrades badly;
 * keyset `scrollId` replaced it). Kept on the schema so sending it produces
 * an explanatory error, not silent discard.
 */
const pageOffsetInput = z
  .number()
  .optional()
  .describe(
    "Removed. Offset pagination is no longer supported and any value other " +
      "than 0 is rejected. Page with the scrollId returned by the previous " +
      "response instead. The field remains on the schema so that sending it " +
      "produces an explanatory error rather than being silently discarded.",
  )
  .refine((value) => value === undefined || value === 0, {
    message:
      "pageOffset is no longer supported - offset pagination was removed. Use the scrollId returned by the previous response to fetch the next page.",
  });

/** What a legacy trace read may be scoped by, and what a caller may send. */
export const traceFilterInputSchema = sharedFiltersInputSchema.extend({
  pageOffset: pageOffsetInput,
  // Non-negative integers only (#2163): a fractional or negative page size
  // reaches ClickHouse as a LIMIT and fails there instead of at the boundary.
  // The ceiling is the registry's enterprise tier; the application clamps to
  // the caller's tier.
  pageSize: z.number().int().positive().max(TRACES_PAGE_SIZE_MAX).optional(),
});

/** The same, plus the paging and ordering the list/search read understands. */
export const traceListInputSchema = traceFilterInputSchema.extend({
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});

/**
 * Opt-in for reviewer corrections. Default false so every existing consumer
 * (evaluations, exports, automations, the REST surface) keeps reading exactly
 * what was ingested; only the add-to-dataset flow asks for the corrected trace.
 */
const withEditOverlayInput = z.boolean().default(false);

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });

const sampleExtrasSchema = z.object({ sortBy: z.string().optional() });

const downloadExtrasSchema = z.object({ includeSpans: z.boolean() });

export const tracesTrpc = defineTrpcContract("traces")
  .query("getAllForProject")
  .withInput(traceListInputSchema)
  .withOutput(tracesForProjectResultSchema)

  .query("getById")
  .withInput(traceScopeSchema.extend({ withEditOverlay: withEditOverlayInput }))
  .withOutput(traceSchema)

  .query("getEvaluations")
  .withInput(traceScopeSchema)
  .withOutput(evaluationSchema.array().optional())

  /**
   * Protected (not public-share): keyed by evaluationId, which is only
   * tenant-scoped, so a share token could otherwise read any evaluation's
   * inputs in the project by supplying another id. Stays project-gated.
   */
  .query("getEvaluationInputs")
  .withInput(z.object({ projectId: z.string(), evaluationId: z.string() }))
  .withOutput(z.record(z.string(), z.unknown()).nullable())

  .query("getEvaluationsMultiple")
  .withInput(z.object({ projectId: z.string(), traceIds: z.array(z.string()).max(TRACE_IDS_MAX) }))
  .withOutput(z.record(z.string(), evaluationSchema.array()))

  .query("getTopicCounts")
  .withInput(traceFilterInputSchema)
  .withOutput(namedTopicCountsSchema)

  .query("getCustomersAndLabels")
  .withInput(traceFilterInputSchema)
  .withOutput(customersAndLabelsResultSchema)

  .query("getTracesByThreadId")
  .withInput(z.object({ projectId: z.string(), threadId: z.string() }))
  .withOutput(traceSchema.array())

  .query("getTracesWithSpans")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string()).max(TRACE_IDS_MAX),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(traceSchema.array())

  .query("getFormattedSpansDigest")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string()).max(TRACE_IDS_MAX),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(z.record(z.string(), z.string()))

  .query("getTracesWithSpansByThreadIds")
  .withInput(
    z.object({
      projectId: z.string(),
      threadIds: z.array(z.string()).max(TRACE_IDS_MAX),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(traceSchema.array())

  .query("getSampleTracesDataset")
  .withInput(traceFilterInputSchema.merge(sampleExtrasSchema))
  .withOutput(traceSchema.array())

  .query("getFieldNames")
  .withInput(z.object({ projectId: z.string(), startDate: z.number(), endDate: z.number() }))
  .withOutput(distinctFieldNamesResultSchema)

  .mutation("getAllForDownload")
  .withInput(traceListInputSchema.merge(downloadExtrasSchema))
  .withOutput(tracesForProjectResultSchema)

  /**
   * The stream carries the process's own `trace_updated` broadcast payload
   * verbatim, which this feature does not shape.
   */
  .subscription("onTraceUpdate")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.unknown())
  .build();
