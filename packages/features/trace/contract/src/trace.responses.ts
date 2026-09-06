/**
 * What the trace feature's tRPC transports answer, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
 */
import { evaluationRunDataSchema } from "@langwatch/evaluation-contract";
import { z } from "zod";
import { traceEditOverlayPatchSchema } from "./trace-edit-overlay.contract";
import {
  sessionGroupCodingAgentDtoSchema,
  sessionGroupDtoSchema,
  sessionGroupsResultSchema,
} from "./trace-session-group";
import { derivedTraceEventSchema } from "./trace-derived-event";
import { spanTreeNodeSchema } from "./trace";
import { spanDetailSchema, spanLangwatchSignalsSchema } from "./trace-view.contract";
import { traceEventRollupSchema, traceLogRecordDtoSchema } from "./trace-span-read-model";
import { traceListPageSchema, traceListViewItemSchema } from "./trace-list-view";
import {
  chatMessageSchema,
  errorCaptureSchema,
  langWatchSpanSchema,
  spanMetricsSchema,
  spanTimestampsSchema,
} from "./trace-format.schemas";

const traceEditOverlayAuthorSchema = z
  .object({ id: z.string(), name: z.string().nullable(), image: z.string().nullable() })
  .strict();

/** One trace's stored correction, as every reader of it receives it. */
export const traceEditOverlayDtoSchema = z
  .object({
    traceId: z.string(),
    patch: traceEditOverlayPatchSchema,
    createdBy: traceEditOverlayAuthorSchema.nullable(),
    updatedBy: traceEditOverlayAuthorSchema.nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

/** `getByTraceId`: no correction stored yet answers `null`, not a 404. */
export const traceEditOverlayOrNullSchema = traceEditOverlayDtoSchema.nullable();

/** One trace's spans, in the waterfall order the application resolved. */
export const spansForTraceSchema = z.array(langWatchSpanSchema);

/** One LLM span reshaped for the prompt studio. */
export const promptStudioSpanSchema = z
  .object({
    spanId: z.string(),
    traceId: z.string(),
    spanName: z.string().nullable(),
    messages: z.array(chatMessageSchema),
    llmConfig: z
      .object({
        model: z.string().nullable(),
        systemPrompt: chatMessageSchema.shape.content,
        temperature: z.number().nullable(),
        maxTokens: z.number().nullable(),
        topP: z.number().nullable(),
        frequencyPenalty: z.number().nullable(),
        presencePenalty: z.number().nullable(),
        seed: z.number().nullable(),
        topK: z.number().nullable(),
        minP: z.number().nullable(),
        repetitionPenalty: z.number().nullable(),
        reasoning: z.string().nullable(),
        verbosity: z.string().nullable(),
        litellmParams: z.record(z.string(), z.unknown()),
      })
      .strict(),
    vendor: z.string().nullable(),
    error: errorCaptureSchema.nullable(),
    timestamps: spanTimestampsSchema.optional(),
    metrics: spanMetricsSchema.nullable(),
    promptHandle: z.string().nullable(),
    promptVersionNumber: z.number().nullable(),
    promptTag: z.string().nullable(),
    promptVariables: z.record(z.string(), z.string()).nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// The trace explorer (`tracesV2.*`)
// ---------------------------------------------------------------------------

/**
 * The read-time redaction flags every content-carrying payload leaves with.
 * Written once here because six of the explorer's answers carry them and a
 * seventh would otherwise state them slightly differently.
 */
const redactionFlagsShape = {
  inputRedacted: z.boolean(),
  outputRedacted: z.boolean(),
  inputVisibleTo: z.string().nullable(),
  outputVisibleTo: z.string().nullable(),
} as const;

/** `list`: one page of the grid, redacted for the viewer. */
export const tracesV2ListPageSchema = traceListPageSchema.extend({
  items: z.array(traceListViewItemSchema.extend(redactionFlagsShape)),
});

/** `sessions`: one page of the Sessions lens, cost- and title-gated. */
export const tracesV2SessionsPageSchema = sessionGroupsResultSchema.extend({
  sessions: z.array(
    sessionGroupDtoSchema.extend({
      ...redactionFlagsShape,
      codingAgent: sessionGroupCodingAgentDtoSchema
        .extend({ titleRedacted: z.boolean().optional() })
        .nullable(),
    }),
  ),
});

/** `listEvents`: the events column's rollups, keyed by trace id. */
export const tracesV2ListEventsSchema = z.record(z.string(), traceEventRollupSchema);

/** `newCount`: how many traces arrived since the grid last painted. */
export const tracesV2NewCountSchema = z.object({ count: z.number() });

/** `suggest`: the typeahead's values for one field. */
export const tracesV2SuggestSchema = z.object({ values: z.array(z.string()) });

/** `conversationContext`: the turns either side of the open trace. */
export const tracesV2ConversationContextSchema = z.object({
  conversationId: z.string(),
  turns: z.array(
    z.object({
      traceId: z.string(),
      timestamp: z.number(),
      name: z.string(),
      rootSpanType: z.string().nullable(),
      status: z.enum(["ok", "error", "warning"]),
      input: z.string().nullable(),
      output: z.string().nullable(),
      ...redactionFlagsShape,
      totalTokens: z.number(),
      totalCost: z.number().nullable(),
    }),
  ),
  total: z.number(),
});

/** `changeName`: the trace and the name it now carries. */
export const tracesV2ChangedNameSchema = z.object({ traceId: z.string(), newName: z.string() });

/** `changeMetadata`: the trace whose reserved metadata was written. */
export const tracesV2ChangedMetadataSchema = z.object({ traceId: z.string() });

/** `spansPaginated`: one page of a trace's full spans, protections applied. */
export const tracesV2SpansPageSchema = z.object({
  spans: z.array(langWatchSpanSchema),
  total: z.number(),
});

/** `spansDelta`: the spans of a live trace newer than a start-time mark. */
export const tracesV2SpansDeltaSchema = z.array(langWatchSpanSchema);

/** `evals`: the evaluation runs recorded against one trace. */
export const tracesV2EvaluationRunsSchema = z.array(evaluationRunDataSchema);

/** `onDiscoverUpdate`: one `discover_updated` signal, as the browser reads it. */
export const tracesV2DiscoverUpdateSchema = z.unknown();

/** `spanTree` / `spanTreeDelta`: waterfall nodes, per-span spend gated. */
export const tracesV2SpanTreeNodesSchema = z.array(spanTreeNodeSchema);

/** `spanLangwatchSignals`: the instrumentation badges, per span. */
export const tracesV2SpanLangwatchSignalsSchema = z.array(spanLangwatchSignalsSchema);

/** `spansFull`: every span of a trace, mapped and redacted. */
export const tracesV2SpanDetailsSchema = z.array(spanDetailSchema);

/** `traceEvents`: the drawer's timeline, protections applied. */
export const tracesV2TraceEventsSchema = z.array(derivedTraceEventSchema);

/** `traceLogs`: the trace's correlated log records, visibility-gated. */
export const tracesV2TraceLogsSchema = z.array(traceLogRecordDtoSchema);
