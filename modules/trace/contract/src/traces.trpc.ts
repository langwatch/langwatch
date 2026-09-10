/**
 * Every `traces.*` procedure, declared once. `traces:view` reads throughout.
 * Anonymous shared reads are NOT here - see `sharedTrace.get` (ADR-057).
 *
 * The filter/list input shapes are trace's own: the same shapes back the v1
 * REST search body and the analytics read input, so they are built once here
 * from `sharedFiltersInputSchema` rather than three times.
 *
 * `getSampleTraces` (the evaluator wizard's precondition-filtered sample) is
 * NOT declared here yet: it needs Evaluation's precondition engine
 * (`EvaluationPreconditionService`, evaluator-contract's field definitions),
 * which is not reachable from Trace without a new `EvaluationApi` capability.
 * Left on `transport/api-trpc/traces.api.ts` until Evaluation exposes one.
 */
import { sharedFiltersInputSchema } from "@langwatch/analytics-contract";
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  customersAndLabelsResultSchema,
  distinctFieldNamesResultSchema,
  namedTopicCountsSchema,
  tracesForProjectResultSchema,
} from "./trace-read.contract.ts";
import { evaluationSchema, traceSchema } from "./trace-format.schemas.ts";

/**
 * Offset pagination was dropped when trace search moved to ClickHouse: deep
 * OFFSET degrades badly, and keyset (`scrollId`) replaced it. The field stays
 * on the schema so sending it produces an explanatory error rather than being
 * silently discarded.
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
  pageSize: z.number().int().positive().optional(),
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
   * Protected (not public-share): the read is keyed by evaluationId, which is
   * only tenant-scoped, so authorization must be the whole project too. A
   * public-share token is scoped to a single trace and could otherwise be
   * used to read any evaluation's inputs in the project by supplying another
   * evaluationId. Public-shared trace drawers already get inputs eagerly from
   * the public `getEvaluations`; this lazy fallback stays project-gated.
   */
  .query("getEvaluationInputs")
  .withInput(z.object({ projectId: z.string(), evaluationId: z.string() }))
  .withOutput(z.record(z.string(), z.unknown()).nullable())

  .query("getEvaluationsMultiple")
  .withInput(z.object({ projectId: z.string(), traceIds: z.array(z.string()) }))
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
      traceIds: z.array(z.string()),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(traceSchema.array())

  .query("getFormattedSpansDigest")
  .withInput(
    z.object({
      projectId: z.string(),
      traceIds: z.array(z.string()),
      withEditOverlay: withEditOverlayInput,
    }),
  )
  .withOutput(z.record(z.string(), z.string()))

  .query("getTracesWithSpansByThreadIds")
  .withInput(
    z.object({
      projectId: z.string(),
      threadIds: z.array(z.string()),
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
