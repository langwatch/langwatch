import type { Named } from "@langwatch/module";
/**
 * What the trace feature's tRPC transports answer, stated once in the
 * contract via `withOutput` rather than implied by a handler's return.
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import { traceEditOverlayPatchSchema } from "./features/edit-overlay/trace-edit-overlay.contract.ts";
import { evaluationRunDataSchema } from "./features/evaluation/trace-evaluation.schemas.ts";
import { traceListPageSchema, traceListViewItemSchema } from "./features/list/trace-list-view.ts";
import {
  sessionGroupCodingAgentDtoSchema,
  sessionGroupDtoSchema,
  sessionGroupsResultSchema,
} from "./features/list/trace-session-group.ts";
import {
  traceEventRollupSchema,
  traceLogRecordDtoSchema,
} from "./features/span/trace-span-read-model.ts";
import {
  chatMessageSchema,
  errorCaptureSchema,
  langWatchSpanSchema,
  spanMetricsSchema,
  spanTimestampsSchema,
} from "./trace-format.schemas.ts";
import { spanDetailSchema, spanLangwatchSignalsSchema } from "./trace-view.contract.ts";
import { spanTreeNodeSchema } from "./trace.ts";

const traceEditOverlayAuthorSchema = z
  .object({ id: z.string(), name: z.string().nullable(), image: z.string().nullable() })
  .strict();

/** One trace's stored correction, as every reader of it receives it. */
const traceEditOverlayDtoSchemaDefinition = z
  .object({
    traceId: z.string(),
    patch: traceEditOverlayPatchSchema,
    createdBy: traceEditOverlayAuthorSchema.nullable(),
    updatedBy: traceEditOverlayAuthorSchema.nullable(),
    createdAt: z.instanceof(Temporal.Instant),
    updatedAt: z.instanceof(Temporal.Instant),
  })
  .strict();
export interface TraceEditOverlayDtoSchema extends Named<
  typeof traceEditOverlayDtoSchemaDefinition
> {}
export const traceEditOverlayDtoSchema: TraceEditOverlayDtoSchema =
  traceEditOverlayDtoSchemaDefinition;

/** `getByTraceId`: no correction stored yet answers `null`, not a 404. */
const traceEditOverlayOrNullSchemaDefinition = traceEditOverlayDtoSchema.nullable();
export interface TraceEditOverlayOrNullSchema extends Named<
  typeof traceEditOverlayOrNullSchemaDefinition
> {}
export const traceEditOverlayOrNullSchema: TraceEditOverlayOrNullSchema =
  traceEditOverlayOrNullSchemaDefinition;

/** One trace's spans, in the waterfall order the application resolved. */
const spansForTraceSchemaDefinition = z.array(langWatchSpanSchema);
export interface SpansForTraceSchema extends Named<typeof spansForTraceSchemaDefinition> {}
export const spansForTraceSchema: SpansForTraceSchema = spansForTraceSchemaDefinition;

/** One LLM span reshaped for the prompt studio. */
const promptStudioSpanSchemaDefinition = z
  .object({
    spanId: z.string(),
    traceId: z.string(),
    spanName: z.string().nullable(),
    messages: z.array(chatMessageSchema),
    llmConfig: z
      .object({
        model: z.string().nullable(),
        systemPrompt: chatMessageSchema.shape.content,
        // Stored attribute text passes through as main hands it ("1.50", "0042").
        temperature: z.union([z.number(), z.string()]).nullable(),
        maxTokens: z.number().nullable(),
        topP: z.number().nullable(),
        frequencyPenalty: z.number().nullable(),
        presencePenalty: z.number().nullable(),
        seed: z.union([z.number(), z.string()]).nullable(),
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
export interface PromptStudioSpanSchema extends Named<typeof promptStudioSpanSchemaDefinition> {}
export const promptStudioSpanSchema: PromptStudioSpanSchema = promptStudioSpanSchemaDefinition;

// ---------------------------------------------------------------------------
// The trace explorer (`traces.*`)
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
const tracesListPageSchemaDefinition = z.object({
  ...traceListPageSchema.shape,
  items: z.array(z.object({ ...traceListViewItemSchema.shape, ...redactionFlagsShape })),
});
export interface TracesListPageSchema extends Named<typeof tracesListPageSchemaDefinition> {}
export const tracesListPageSchema: TracesListPageSchema = tracesListPageSchemaDefinition;

/** `sessions`: one page of the Sessions lens, cost- and title-gated. */
const tracesSessionsPageSchemaDefinition = z.object({
  ...sessionGroupsResultSchema.shape,
  sessions: z.array(
    z.object({
      ...sessionGroupDtoSchema.shape,
      ...redactionFlagsShape,
      codingAgent: z
        .object({
          ...sessionGroupCodingAgentDtoSchema.shape,
          titleRedacted: z.boolean().optional(),
        })
        .nullable(),
    }),
  ),
});
export interface TracesSessionsPageSchema extends Named<
  typeof tracesSessionsPageSchemaDefinition
> {}
export const tracesSessionsPageSchema: TracesSessionsPageSchema =
  tracesSessionsPageSchemaDefinition;
export type TracesSessionsPage = z.infer<typeof tracesSessionsPageSchema>;

/** `listEvents`: the events column's rollups, keyed by trace id. */
const tracesListEventsSchemaDefinition = z.record(z.string(), traceEventRollupSchema);
export interface TracesListEventsSchema extends Named<typeof tracesListEventsSchemaDefinition> {}
export const tracesListEventsSchema: TracesListEventsSchema = tracesListEventsSchemaDefinition;

/** `newCount`: how many traces arrived since the grid last painted. */
const tracesNewCountSchemaDefinition = z.object({ count: z.number() });
export interface TracesNewCountSchema extends Named<typeof tracesNewCountSchemaDefinition> {}
export const tracesNewCountSchema: TracesNewCountSchema = tracesNewCountSchemaDefinition;

/** `suggest`: the typeahead's values for one field. */
const tracesSuggestSchemaDefinition = z.object({ values: z.array(z.string()) });
export interface TracesSuggestSchema extends Named<typeof tracesSuggestSchemaDefinition> {}
export const tracesSuggestSchema: TracesSuggestSchema = tracesSuggestSchemaDefinition;

/** `conversationContext`: the turns either side of the open trace. */
const tracesConversationContextSchemaDefinition = z.object({
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
export interface TracesConversationContextSchema extends Named<
  typeof tracesConversationContextSchemaDefinition
> {}
export const tracesConversationContextSchema: TracesConversationContextSchema =
  tracesConversationContextSchemaDefinition;
export type TracesConversationContext = z.infer<typeof tracesConversationContextSchema>;

/** `changeName`: the trace and the name it now carries. */
const tracesChangedNameSchemaDefinition = z.object({ traceId: z.string(), newName: z.string() });
export interface TracesChangedNameSchema extends Named<typeof tracesChangedNameSchemaDefinition> {}
export const tracesChangedNameSchema: TracesChangedNameSchema = tracesChangedNameSchemaDefinition;

/** `spansPaginated`: one page of a trace's full spans, protections applied. */
const tracesSpansPageSchemaDefinition = z.object({
  spans: z.array(langWatchSpanSchema),
  total: z.number(),
});
export interface TracesSpansPageSchema extends Named<typeof tracesSpansPageSchemaDefinition> {}
export const tracesSpansPageSchema: TracesSpansPageSchema = tracesSpansPageSchemaDefinition;

/** `spansDelta`: the spans of a live trace newer than a start-time mark. */
const tracesSpansDeltaSchemaDefinition = z.array(langWatchSpanSchema);
export interface TracesSpansDeltaSchema extends Named<typeof tracesSpansDeltaSchemaDefinition> {}
export const tracesSpansDeltaSchema: TracesSpansDeltaSchema = tracesSpansDeltaSchemaDefinition;

/** `evals`: the evaluation runs recorded against one trace. */
const tracesEvaluationRunsSchemaDefinition = z.array(evaluationRunDataSchema);
export interface TracesEvaluationRunsSchema extends Named<
  typeof tracesEvaluationRunsSchemaDefinition
> {}
export const tracesEvaluationRunsSchema: TracesEvaluationRunsSchema =
  tracesEvaluationRunsSchemaDefinition;

/** `spanTree` / `spanTreeDelta`: waterfall nodes, per-span spend gated. */
const tracesSpanTreeNodesSchemaDefinition = z.array(spanTreeNodeSchema);
export interface TracesSpanTreeNodesSchema extends Named<
  typeof tracesSpanTreeNodesSchemaDefinition
> {}
export const tracesSpanTreeNodesSchema: TracesSpanTreeNodesSchema =
  tracesSpanTreeNodesSchemaDefinition;

/** `spanLangwatchSignals`: the instrumentation badges, per span. */
const tracesSpanLangwatchSignalsSchemaDefinition = z.array(spanLangwatchSignalsSchema);
export interface TracesSpanLangwatchSignalsSchema extends Named<
  typeof tracesSpanLangwatchSignalsSchemaDefinition
> {}
export const tracesSpanLangwatchSignalsSchema: TracesSpanLangwatchSignalsSchema =
  tracesSpanLangwatchSignalsSchemaDefinition;

/** `spansFull`: every span of a trace, mapped and redacted. */
const tracesSpanDetailsSchemaDefinition = z.array(spanDetailSchema);
export interface TracesSpanDetailsSchema extends Named<typeof tracesSpanDetailsSchemaDefinition> {}
export const tracesSpanDetailsSchema: TracesSpanDetailsSchema = tracesSpanDetailsSchemaDefinition;

/**
 * Trace-level event shape, derived from a span's OTel events. Read from
 * stored_spans on demand (`getTraceEventsByTraceId`), not hoisted onto the
 * fold — that made folding O(n^2).
 */
const derivedTraceEventSchemaDefinition = z.object({
  spanId: z.string(),
  timestamp: z.number(),
  name: z.string(),
  attributes: z.record(z.string(), z.string()),
});
export interface DerivedTraceEventSchema extends Named<typeof derivedTraceEventSchemaDefinition> {}
export const derivedTraceEventSchema: DerivedTraceEventSchema = derivedTraceEventSchemaDefinition;

export type DerivedTraceEvent = z.infer<typeof derivedTraceEventSchema>;

/** `traceEvents`: the drawer's timeline, protections applied. */
const tracesTraceEventsSchemaDefinition = z.array(derivedTraceEventSchema);
export interface TracesTraceEventsSchema extends Named<typeof tracesTraceEventsSchemaDefinition> {}
export const tracesTraceEventsSchema: TracesTraceEventsSchema = tracesTraceEventsSchemaDefinition;

/** `traceLogs`: the trace's correlated log records, visibility-gated. */
const tracesTraceLogsSchemaDefinition = z.array(traceLogRecordDtoSchema);
export interface TracesTraceLogsSchema extends Named<typeof tracesTraceLogsSchemaDefinition> {}
export const tracesTraceLogsSchema: TracesTraceLogsSchema = tracesTraceLogsSchemaDefinition;

/** `getFieldRedactionStatus`: whether this reader may see captured input and output, and who. */
const tracesFieldRedactionStatusSchemaDefinition = z
  .object({
    isRedacted: z.object({ input: z.boolean(), output: z.boolean() }).strict(),
    visibleTo: z.object({ input: z.string().nullable(), output: z.string().nullable() }).strict(),
  })
  .strict();
export interface TracesFieldRedactionStatusSchema extends Named<
  typeof tracesFieldRedactionStatusSchemaDefinition
> {}
export const tracesFieldRedactionStatusSchema: TracesFieldRedactionStatusSchema =
  tracesFieldRedactionStatusSchemaDefinition;
export type TracesFieldRedactionStatus = z.infer<typeof tracesFieldRedactionStatusSchema>;
