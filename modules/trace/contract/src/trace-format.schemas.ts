import type { Named } from "@langwatch/module";
import { z } from "zod";

// --------------------------------------------------------------------------- Tracer schemas
// (Zod-first). Every shared trace/span/evaluation shape is defined as a Zod schema and its
// TypeScript type is inferred with z.infer, so the schema and the type can never drift apart.
// The few ElasticSearch and dataset shapes that are pure structural transforms (Omit/Partial of
// the schemas above) stay as inferred-type derivations.

const chatRoleSchema = z.union([
  z.literal("system"),
  /**
   * OpenAI Responses-dialect spelling of the system role.
   */
  z.literal("developer"),
  z.literal("user"),
  z.literal("assistant"),
  z.literal("function"),
  z.literal("tool"),
  z.literal("unknown"),
]);

const functionCallSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.string(),
  function: functionCallSchema,
});

const rAGChunkSchemaDefinition = z.object({
  document_id: z.string().optional().nullable(),
  chunk_id: z.string().optional().nullable(),
  content: z.union([z.string(), z.record(z.string(), z.any()), z.array(z.any())]),
});
export interface RAGChunkSchema extends Named<typeof rAGChunkSchemaDefinition> {}
export const rAGChunkSchema: RAGChunkSchema = rAGChunkSchemaDefinition;

export type RAGChunk = z.infer<typeof rAGChunkSchema>;

const contextsSchemaDefinition = z.object({
  traceId: z.string(),
  contexts: z.array(rAGChunkSchema),
});
export interface ContextsSchema extends Named<typeof contextsSchemaDefinition> {}
export const contextsSchema: ContextsSchema = contextsSchemaDefinition;

export type Contexts = z.infer<typeof contextsSchema>;

const chatRichContentSchemaDefinition = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().optional(),
    /** pi-ai uses `content` instead of `text` inside text blocks */
    content: z.string().optional(),
  }),
  z.object({
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z
      .object({
        url: z.string(),
        detail: z.union([z.literal("auto"), z.literal("low"), z.literal("high")]).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("tool_call"),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    args: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    result: z.any().optional(),
  }),
  /** AI SDK v5 tool parts, stored as sent (WEB-9104). */
  z.object({
    type: z.literal("tool-call"),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool-result"),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    output: z.unknown().optional(),
  }),
  /**
   * AG-UI binary content part. Used for audio/image/video/file attachments. Mutually-exclusive
   * payload: exactly one of `data` (inline base64), `url` (already-externalized reference), or
   * `id` (stored_objects id) is present.
   */
  z.object({
    type: z.literal("binary"),
    mimeType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
    filename: z.string().optional(),
  }),
  /**
   * OpenAI Realtime `input_audio` content part. Pre-extraction the payload is inline base64 (`{
   * data, format }`); after ingest-side stored-objects extraction it is rewritten to a
   * reference (`{ url, mimeType }`) pointing at /api/files/{projectId}/{id}.
   */
  z.object({
    type: z.literal("input_audio"),
    input_audio: z.object({
      data: z.string().optional(),
      format: z.string().optional(),
      url: z.string().optional(),
      mimeType: z.string().optional(),
      id: z.string().optional(),
    }),
  }),
  /**
   * AG-UI media `audio` content part. A typed `source` carries either an
   * externalized `url` or inline base64 `data`, with an optional `mimeType`.
   * Shared shape with image/video/document media parts (see `visitContentPart`).
   */
  z.object({
    type: z.literal("audio"),
    source: z.object({
      type: z.union([z.literal("url"), z.literal("data")]),
      value: z.string(),
      mimeType: z.string().optional(),
    }),
  }),
  /**
   * AI-SDK image part. `image` is a data: URI pre-extraction, a /api/files/{projectId}/{id}
   * reference after ingest-side extraction, or an external http(s) URL (passed through, never
   * re-hosted).
   */
  z.object({
    type: z.literal("image"),
    image: z.string(),
    mediaType: z.string().optional(),
  }),
  /**
   * AI-SDK file part. Non-audio mediaTypes are externalized to a `binary`
   * reference at ingest; audio/* mediaTypes route through the `input_audio`
   * externalization path (see `visitContentPart`).
   */
  z.object({
    type: z.literal("file"),
    mediaType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    filename: z.string().optional(),
  }),
  /**
   * OpenAI ChatCompletion file part (scenario docs: multimodal-files). `file_data` is a data:
   * URI or raw base64; `file_id` references a file hosted on the provider side and carries no
   * bytes, so it passes through extraction unchanged.
   */
  z.object({
    type: z.literal("file"),
    file: z.object({
      file_data: z.string().optional(),
      file_id: z.string().optional(),
      filename: z.string().optional(),
    }),
  }),
]);
export interface ChatRichContentSchema extends Named<typeof chatRichContentSchemaDefinition> {}
export const chatRichContentSchema: ChatRichContentSchema = chatRichContentSchemaDefinition;

export type ChatRichContent = z.infer<typeof chatRichContentSchema>;

const chatMessageSchemaDefinition = z.object({
  role: chatRoleSchema.optional(),
  content: z
    .union([z.string(), z.array(chatRichContentSchema)])
    .optional()
    .nullable(),
  /** Vercel AI SDK / pi-ai use `parts` instead of `content` */
  parts: z.array(chatRichContentSchema).optional(),
  function_call: functionCallSchema.optional().nullable(),
  tool_calls: z.array(toolCallSchema).optional().nullable(),
  tool_call_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  reasoning_content: z.string().optional().nullable(),
});
export interface ChatMessageSchema extends Named<typeof chatMessageSchemaDefinition> {}
export const chatMessageSchema: ChatMessageSchema = chatMessageSchemaDefinition;

export type ChatMessage = z.infer<typeof chatMessageSchema>;

const typedValueTextSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
});

type TypedValueText = z.infer<typeof typedValueTextSchema>;

const typedValueRawSchema = z.object({
  type: z.literal("raw"),
  value: z.string(),
});

type TypedValueRaw = z.infer<typeof typedValueRawSchema>;

const jSONSerializableSchema = z
  .union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.any()), z.array(z.any())])
  .nullable();

const typedValueJsonSchemaDefinition = z.object({
  type: z.literal("json"),
  value: jSONSerializableSchema,
});
export interface TypedValueJsonSchema extends Named<typeof typedValueJsonSchemaDefinition> {}
export const typedValueJsonSchema: TypedValueJsonSchema = typedValueJsonSchemaDefinition;

export type TypedValueJson = z.infer<typeof typedValueJsonSchema>;

const moneySchemaDefinition = z.object({
  currency: z.string(),
  amount: z.number(),
});
export interface MoneySchema extends Named<typeof moneySchemaDefinition> {}
export const moneySchema: MoneySchema = moneySchemaDefinition;

export type Money = z.infer<typeof moneySchema>;

const evaluationResultSchemaDefinition = z.object({
  status: z.union([z.literal("processed"), z.literal("skipped"), z.literal("error")]),
  passed: z.boolean().optional().nullable(),
  score: z.number().optional().nullable(),
  label: z.string().optional().nullable(),
  details: z.string().optional().nullable(),
  cost: moneySchema.optional().nullable(),
});
export interface EvaluationResultSchema extends Named<typeof evaluationResultSchemaDefinition> {}
export const evaluationResultSchema: EvaluationResultSchema = evaluationResultSchemaDefinition;

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

const typedValueGuardrailResultSchemaDefinition = z.object({
  type: z.literal("guardrail_result"),
  value: evaluationResultSchema,
});
export interface TypedValueGuardrailResultSchema extends Named<
  typeof typedValueGuardrailResultSchemaDefinition
> {}
export const typedValueGuardrailResultSchema: TypedValueGuardrailResultSchema =
  typedValueGuardrailResultSchemaDefinition;

export type TypedValueGuardrailResult = z.infer<typeof typedValueGuardrailResultSchema>;

const typedValueEvaluationResultSchemaDefinition = z.object({
  type: z.literal("evaluation_result"),
  value: evaluationResultSchema,
});
export interface TypedValueEvaluationResultSchema extends Named<
  typeof typedValueEvaluationResultSchemaDefinition
> {}
export const typedValueEvaluationResultSchema: TypedValueEvaluationResultSchema =
  typedValueEvaluationResultSchemaDefinition;

export type TypedValueEvaluationResult = z.infer<typeof typedValueEvaluationResultSchema>;

const typedValueChatMessagesSchemaDefinition = z.object({
  type: z.literal("chat_messages"),
  value: z.array(chatMessageSchema),
});
export interface TypedValueChatMessagesSchema extends Named<
  typeof typedValueChatMessagesSchemaDefinition
> {}
export const typedValueChatMessagesSchema: TypedValueChatMessagesSchema =
  typedValueChatMessagesSchemaDefinition;

export type TypedValueChatMessages = z.infer<typeof typedValueChatMessagesSchema>;

export type SpanInputOutput =
  | TypedValueText
  | TypedValueChatMessages
  | TypedValueGuardrailResult
  | TypedValueEvaluationResult
  | TypedValueJson
  | TypedValueRaw
  | {
      type: "list";
      value: SpanInputOutput[];
    };

/** Published as the `SpanInputOutput` component, which the list arm refers back to. */
export const spanInputOutputSchema: z.ZodType<SpanInputOutput> = z
  .lazy(() =>
    z.union([
      typedValueTextSchema,
      typedValueChatMessagesSchema,
      typedValueGuardrailResultSchema,
      typedValueEvaluationResultSchema,
      typedValueJsonSchema,
      typedValueRawSchema,
      z.object({
        type: z.literal("list"),
        value: z.array(spanInputOutputSchema),
      }),
    ]),
  )
  .meta({ id: "SpanInputOutput" });

const errorCaptureSchemaDefinition = z.object({
  has_error: z.literal(true),
  message: z.string(),
  stacktrace: z.array(z.string()),
});
export interface ErrorCaptureSchema extends Named<typeof errorCaptureSchemaDefinition> {}
export const errorCaptureSchema: ErrorCaptureSchema = errorCaptureSchemaDefinition;

export type ErrorCapture = z.infer<typeof errorCaptureSchema>;

const spanMetricsSchemaDefinition = z.object({
  prompt_tokens: z.number().optional().nullable(),
  completion_tokens: z.number().optional().nullable(),
  reasoning_tokens: z.number().optional().nullable(),
  cache_read_input_tokens: z.number().optional().nullable(),
  cache_creation_input_tokens: z.number().optional().nullable(),
  tokens_estimated: z.boolean().optional().nullable(),
  cost: z.number().optional().nullable(),
});
export interface SpanMetricsSchema extends Named<typeof spanMetricsSchemaDefinition> {}
export const spanMetricsSchema: SpanMetricsSchema = spanMetricsSchemaDefinition;

export type SpanMetrics = z.infer<typeof spanMetricsSchema>;

const reservedSpanParamsSchemaDefinition = z.object({
  frequency_penalty: z.number().optional().nullable(),
  logit_bias: z.record(z.string(), z.number()).optional().nullable(),
  logprobs: z.boolean().optional().nullable(),
  top_logprobs: z.number().optional().nullable(),
  max_tokens: z.number().optional().nullable(),
  n: z.number().optional().nullable(),
  presence_penalty: z.number().optional().nullable(),
  seed: z.number().optional().nullable(),
  stop: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .nullable(),
  stream: z.boolean().optional().nullable(),
  temperature: z.number().optional().nullable(),
  top_p: z.number().optional().nullable(),
  tools: z.array(z.record(z.string(), z.any())).optional().nullable(),
  tool_choice: z
    .union([z.record(z.string(), z.any()), z.string()])
    .optional()
    .nullable(),
  parallel_tool_calls: z.boolean().optional().nullable(),
  functions: z.array(z.record(z.string(), z.any())).optional().nullable(),
  user: z.string().optional().nullable(),
  reasoning_effort: z.string().optional().nullable(),
});
export interface ReservedSpanParamsSchema extends Named<
  typeof reservedSpanParamsSchemaDefinition
> {}
export const reservedSpanParamsSchema: ReservedSpanParamsSchema =
  reservedSpanParamsSchemaDefinition;

export type ReservedSpanParams = z.infer<typeof reservedSpanParamsSchema>;

const spanParamsSchemaDefinition = reservedSpanParamsSchema.and(z.record(z.string(), z.any()));
export interface SpanParamsSchema extends Named<typeof spanParamsSchemaDefinition> {}
export const spanParamsSchema: SpanParamsSchema = spanParamsSchemaDefinition;

export type SpanParams = z.infer<typeof spanParamsSchema>;

const spanTimestampsSchemaDefinition = z.object({
  ignore_timestamps_on_write: z.boolean().optional().nullable(),
  started_at: z.number(),
  first_token_at: z.number().optional().nullable(),
  finished_at: z.number(),
});
export interface SpanTimestampsSchema extends Named<typeof spanTimestampsSchemaDefinition> {}
export const spanTimestampsSchema: SpanTimestampsSchema = spanTimestampsSchemaDefinition;

export type SpanTimestamps = z.infer<typeof spanTimestampsSchema>;

const spanTypesSchemaDefinition = z.union([
  z.literal("span"),
  z.literal("llm"),
  z.literal("chain"),
  z.literal("tool"),
  z.literal("agent"),
  z.literal("rag"),
  z.literal("guardrail"),
  z.literal("evaluation"),
  // Low-code
  z.literal("workflow"),
  z.literal("component"),
  // DSPy
  z.literal("module"),
  // OpenTelemetry
  z.literal("server"),
  z.literal("client"),
  z.literal("producer"),
  z.literal("consumer"),
  // Other
  z.literal("task"), // openllmetry
  z.literal("unknown"),
]);
export interface SpanTypesSchema extends Named<typeof spanTypesSchemaDefinition> {}
export const spanTypesSchema: SpanTypesSchema = spanTypesSchemaDefinition;

export type SpanTypes = z.infer<typeof spanTypesSchema>;

/**
 * A verdict as legacy SDKs sent it, before `status` was required. Main's legacy span mapper
 * carried it through as-is, so the legacy span shape accepts any JSON value in its place.
 */
const typedValueLegacyVerdictSchemaDefinition = z.object({
  type: z.union([z.literal("evaluation_result"), z.literal("guardrail_result")]),
  value: jSONSerializableSchema,
});
export interface TypedValueLegacyVerdictSchema extends Named<
  typeof typedValueLegacyVerdictSchemaDefinition
> {}
export const typedValueLegacyVerdictSchema: TypedValueLegacyVerdictSchema =
  typedValueLegacyVerdictSchemaDefinition;

/** What a legacy span's input or output carries: the shared shape, or a legacy verdict. */
const legacySpanInputOutputSchemaDefinition = z.union([
  spanInputOutputSchema,
  typedValueLegacyVerdictSchema,
]);
export interface LegacySpanInputOutputSchema extends Named<
  typeof legacySpanInputOutputSchemaDefinition
> {}
export const legacySpanInputOutputSchema: LegacySpanInputOutputSchema =
  legacySpanInputOutputSchemaDefinition;

export type LegacySpanInputOutput = z.infer<typeof legacySpanInputOutputSchema>;

const baseSpanSchemaDefinition = z.object({
  span_id: z.string(),
  parent_id: z.string().optional().nullable(),
  trace_id: z.string(),
  type: spanTypesSchema,
  name: z.string().optional().nullable(),
  input: legacySpanInputOutputSchema.optional().nullable(),
  output: legacySpanInputOutputSchema.optional().nullable(),
  error: errorCaptureSchema.optional().nullable(),
  timestamps: spanTimestampsSchema,
  metrics: spanMetricsSchema.optional().nullable(),
  params: spanParamsSchema.optional().nullable(),
});
export interface BaseSpanSchema extends Named<typeof baseSpanSchemaDefinition> {}
export const baseSpanSchema: BaseSpanSchema = baseSpanSchemaDefinition;

export type BaseSpan = z.infer<typeof baseSpanSchema>;

const lLMSpanSchemaDefinition = z.object({
  ...baseSpanSchema.shape,
  type: z.literal("llm"),
  // TODO: deprecate field, standardize on litellm model names
  vendor: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
});
export interface LLMSpanSchema extends Named<typeof lLMSpanSchemaDefinition> {}
export const lLMSpanSchema: LLMSpanSchema = lLMSpanSchemaDefinition;

export type LLMSpan = z.infer<typeof lLMSpanSchema>;

const rAGSpanSchemaDefinition = z.object({
  ...baseSpanSchema.shape,
  type: z.literal("rag"),
  contexts: z.array(rAGChunkSchema),
});
export interface RAGSpanSchema extends Named<typeof rAGSpanSchemaDefinition> {}
export const rAGSpanSchema: RAGSpanSchema = rAGSpanSchemaDefinition;

export type RAGSpan = z.infer<typeof rAGSpanSchema>;

const langWatchSpanSchemaDefinition = z.union([lLMSpanSchema, rAGSpanSchema, baseSpanSchema]);
export interface LangWatchSpanSchema extends Named<typeof langWatchSpanSchemaDefinition> {}
export const langWatchSpanSchema: LangWatchSpanSchema = langWatchSpanSchemaDefinition;

export type Span = z.infer<typeof langWatchSpanSchema>;

const spanInputOutputValidatorSchema = spanInputOutputSchema.and(
  z.object({
    value: z.any(),
  }),
);

const spanValidatorSchemaDefinition = z
  .union([
    lLMSpanSchema.omit({ input: true, output: true, params: true }),
    rAGSpanSchema.omit({ input: true, output: true, params: true }),
    baseSpanSchema.omit({ input: true, output: true, params: true }),
  ])
  .and(
    z.object({
      input: spanInputOutputValidatorSchema.optional().nullable(),
      output: spanInputOutputValidatorSchema.optional().nullable(),
      params: z.record(z.string(), z.any()).optional().nullable(),
    }),
  );
export interface SpanValidatorSchema extends Named<typeof spanValidatorSchemaDefinition> {}
export const spanValidatorSchema: SpanValidatorSchema = spanValidatorSchemaDefinition;

export type SpanValidator = z.infer<typeof spanValidatorSchema>;

export type ElasticSearchInputOutput = {
  type: SpanInputOutput["type"];
  value: string;
};

// Dead ElasticSearch shape kept as a structural type only (no schema needed).
export type ElasticSearchSpan = Omit<
  BaseSpan & Partial<Omit<RAGSpan, "type">> & Partial<Omit<LLMSpan, "type">>,
  "input" | "output"
> & {
  project_id: string;
  input?: ElasticSearchInputOutput | null;
  output?: ElasticSearchInputOutput | null;
  timestamps: SpanTimestamps & { inserted_at: number; updated_at: number };
};

const traceInputSchemaDefinition = z.object({
  value: z.string(),
});
export interface TraceInputSchema extends Named<typeof traceInputSchemaDefinition> {}
export const traceInputSchema: TraceInputSchema = traceInputSchemaDefinition;

export type TraceInput = z.infer<typeof traceInputSchema>;

const traceOutputSchemaDefinition = z.object({
  value: z.string(),
});
export interface TraceOutputSchema extends Named<typeof traceOutputSchemaDefinition> {}
export const traceOutputSchema: TraceOutputSchema = traceOutputSchemaDefinition;

export type TraceOutput = z.infer<typeof traceOutputSchema>;

const primitiveTypeSchema = z
  .union([z.string(), z.number(), z.boolean(), z.undefined()])
  .nullable();

const reservedTraceMetadataSchemaDefinition = z.object({
  thread_id: z.string().optional().nullable(),
  user_id: z.string().optional().nullable(),
  customer_id: z.string().optional().nullable(),
  labels: z.array(z.string()).optional().nullable(),
  topic_id: z.string().optional().nullable(),
  subtopic_id: z.string().optional().nullable(),
  sdk_name: z.string().optional().nullable(),
  sdk_version: z.string().optional().nullable(),
  sdk_language: z.string().optional().nullable(),
  telemetry_sdk_language: z.string().optional().nullable(),
  telemetry_sdk_name: z.string().optional().nullable(),
  telemetry_sdk_version: z.string().optional().nullable(),
  prompt_ids: z.array(z.string()).optional().nullable(),
  prompt_version_ids: z.array(z.string()).optional().nullable(),
});
export interface ReservedTraceMetadataSchema extends Named<
  typeof reservedTraceMetadataSchemaDefinition
> {}
export const reservedTraceMetadataSchema: ReservedTraceMetadataSchema =
  reservedTraceMetadataSchemaDefinition;

export type ReservedTraceMetadata = z.infer<typeof reservedTraceMetadataSchema>;

const reservedTraceMetadataMappingSchemaDefinition = z.record(
  z.string(),
  reservedTraceMetadataSchema.keyof(),
);
export interface ReservedTraceMetadataMappingSchema extends Named<
  typeof reservedTraceMetadataMappingSchemaDefinition
> {}
export const reservedTraceMetadataMappingSchema: ReservedTraceMetadataMappingSchema =
  reservedTraceMetadataMappingSchemaDefinition;

export type ReservedTraceMetadataMapping = z.infer<typeof reservedTraceMetadataMappingSchema>;

const customMetadataSchemaDefinition = z.record(
  z.string(),
  z.union([
    primitiveTypeSchema,
    z.array(primitiveTypeSchema),
    z.record(z.string(), primitiveTypeSchema),
    z.record(z.string(), z.record(z.string(), primitiveTypeSchema)),
  ]),
);
export interface CustomMetadataSchema extends Named<typeof customMetadataSchemaDefinition> {}
export const customMetadataSchema: CustomMetadataSchema = customMetadataSchemaDefinition;

export type CustomMetadata = z.infer<typeof customMetadataSchema>;

const traceMetadataSchemaDefinition = reservedTraceMetadataSchema.and(customMetadataSchema);
export interface TraceMetadataSchema extends Named<typeof traceMetadataSchemaDefinition> {}
export const traceMetadataSchema: TraceMetadataSchema = traceMetadataSchemaDefinition;

export type TraceMetadata = z.infer<typeof traceMetadataSchema>;

/**
 * A metric key round-trips through the event drilldown's composite key
 * (`<key>\x1F<value>`, see EVENT_METRIC_SEP). A key carrying the separator
 * itself can no longer be split unambiguously, so reject it at ingest.
 */
const eventMetricKeySchema = z.string().refine((key) => !key.includes("\x1f"), {
  message: "Metric key must not contain the ASCII unit separator (0x1F)",
});

const langWatchEventSchemaDefinition = z.object({
  event_id: z.string(),
  event_type: z.string(), // Type of event (e.g., 'thumbs_up_down', 'add_to_cart')
  project_id: z.string(),
  metrics: z.record(eventMetricKeySchema, z.number()),
  event_details: z.record(z.string(), z.string()),
  trace_id: z.string(),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
});
export interface LangWatchEventSchema extends Named<typeof langWatchEventSchemaDefinition> {}
export const langWatchEventSchema: LangWatchEventSchema = langWatchEventSchemaDefinition;

export type Event = z.infer<typeof langWatchEventSchema>;

const elasticSearchEventSchemaDefinition = z.object({
  ...langWatchEventSchema.omit({ metrics: true, event_details: true }).shape,
  metrics: z.array(
    z.object({
      key: z.string(),
      value: z.number(),
    }),
  ),
  event_details: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});
export interface ElasticSearchEventSchema extends Named<
  typeof elasticSearchEventSchemaDefinition
> {}
export const elasticSearchEventSchema: ElasticSearchEventSchema =
  elasticSearchEventSchemaDefinition;

export type ElasticSearchEvent = z.infer<typeof elasticSearchEventSchema>;

const evaluationStatusSchema = z.union([
  z.literal("scheduled"),
  z.literal("in_progress"),
  z.literal("error"),
  z.literal("skipped"),
  z.literal("processed"),
]);

/**
 * The `json_encoded_event` payload of a `langwatch.evaluation.custom` span
 * event. The SDKs write `null` for every field the caller left out, so each
 * optional field takes null as well as absence.
 */
const sdkEvaluationSchemaDefinition = z.looseObject({
  evaluation_id: z.string().nullish(),
  evaluator_id: z.string().nullish(),
  span_id: z.string().nullish(),
  name: z.string(),
  type: z.string().nullish(),
  is_guardrail: z.boolean().nullish(),
  status: z.enum(["processed", "skipped", "error"]).nullish(),
  passed: z.boolean().nullish(),
  score: z.number().nullish(),
  label: z.string().nullish(),
  details: z.string().nullish(),
  cost_id: z.string().nullish(),
  error: z
    .object({
      message: z.string(),
      stacktrace: z.array(z.string()).nullish(),
    })
    .nullish(),
  timestamps: z
    .object({
      started_at: z.number().nullish(),
      finished_at: z.number().nullish(),
    })
    .nullish(),
});
export interface SdkEvaluationSchema extends Named<typeof sdkEvaluationSchemaDefinition> {}
export const sdkEvaluationSchema: SdkEvaluationSchema = sdkEvaluationSchemaDefinition;

export type SdkEvaluation = z.infer<typeof sdkEvaluationSchema>;

const evaluationSchemaDefinition = z.object({
  evaluation_id: z.string(),
  evaluator_id: z.string(),
  span_id: z.string().optional().nullable(),
  name: z.string(),
  type: z.string().optional().nullable(),
  is_guardrail: z.boolean().optional().nullable(),
  evaluation_thread_id: z.string().optional().nullable(), // Thread ID
  status: evaluationStatusSchema,
  passed: z.boolean().optional().nullable(),
  score: z.number().optional().nullable(),
  label: z.string().optional().nullable(),
  details: z.string().optional().nullable(),
  inputs: z.record(z.string(), z.any()).optional().nullable(),
  error: errorCaptureSchema.optional().nullable(),
  retries: z.number().optional().nullable(),
  timestamps: z.object({
    ignore_timestamps_on_write: z.boolean().optional().nullable(),
    inserted_at: z.number().optional().nullable(),
    started_at: z.number().optional().nullable(),
    finished_at: z.number().optional().nullable(),
    updated_at: z.number().optional().nullable(),
  }),
});
export interface EvaluationSchema extends Named<typeof evaluationSchemaDefinition> {}
export const evaluationSchema: EvaluationSchema = evaluationSchemaDefinition;

export type Evaluation = z.infer<typeof evaluationSchema>;

export const elasticSearchEvaluationSchema = evaluationSchema;

export type ElasticSearchEvaluation = z.infer<typeof elasticSearchEvaluationSchema>;

const rESTEvaluationSchemaDefinition = z.object({
  ...evaluationSchema.omit({
    evaluation_id: true,
    evaluator_id: true,
    status: true,
    timestamps: true,
    retries: true,
  }).shape,
  evaluation_id: z.string().optional().nullable(),
  evaluator_id: z.string().optional().nullable(),
  status: z
    .union([z.literal("processed"), z.literal("skipped"), z.literal("error")])
    .optional()
    .nullable(),
  timestamps: z
    .object({
      started_at: z.number().optional().nullable(),
      finished_at: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
});
export interface RESTEvaluationSchema extends Named<typeof rESTEvaluationSchemaDefinition> {}
export const rESTEvaluationSchema: RESTEvaluationSchema = rESTEvaluationSchemaDefinition;

export type RESTEvaluation = z.infer<typeof rESTEvaluationSchema>;

const tracePrivacySchemaDefinition = z.object({
  // Content categories that a `drop` privacy policy stripped before the spans were stored,
  // derived at read time from the marker the drop stamps on each span. The content was never
  // stored and cannot be recovered, which is what distinguishes it from a read-time `restrict`
  // (the data is kept and hidden by audience, surfaced through the field-redaction path).
  // Absent when nothing was dropped.
  droppedCategories: z.array(z.string()).optional(),
});
export interface TracePrivacySchema extends Named<typeof tracePrivacySchemaDefinition> {}
export const tracePrivacySchema: TracePrivacySchema = tracePrivacySchemaDefinition;

export type TracePrivacy = z.infer<typeof tracePrivacySchema>;

const traceSchemaDefinition = z.object({
  trace_id: z.string(),
  project_id: z.string(),
  metadata: traceMetadataSchema,
  privacy: tracePrivacySchema.optional(),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
  input: traceInputSchema.optional(),
  output: traceOutputSchema.optional(),
  contexts: z.array(rAGChunkSchema).optional(),
  expected_output: z
    .object({
      value: z.string(),
    })
    .optional(),
  metrics: z
    .object({
      first_token_ms: z.number().optional().nullable(),
      total_time_ms: z.number().optional().nullable(),
      prompt_tokens: z.number().optional().nullable(),
      completion_tokens: z.number().optional().nullable(),
      reasoning_tokens: z.number().optional().nullable(),
      cache_read_input_tokens: z.number().optional().nullable(),
      cache_creation_input_tokens: z.number().optional().nullable(),
      cache_creation_5m_input_tokens: z.number().optional().nullable(),
      cache_creation_1h_input_tokens: z.number().optional().nullable(),
      context_size_tokens: z.number().optional().nullable(),
      total_cost: z.number().optional().nullable(),
      tokens_estimated: z.boolean().optional().nullable(),
    })
    .optional(),
  error: errorCaptureSchema.optional().nullable(),
  indexing_md5s: z.array(z.string()).optional(),
  events: z.array(langWatchEventSchema).optional(),
  evaluations: z.array(evaluationSchema).optional(),
  spans: z.array(langWatchSpanSchema),
  // Set server-side when content was teaser-redacted by the plan's
  // visibility window — the UI renders the upgrade CTA off this flag.
  redacted_by_visibility_window: z.boolean().optional(),
});
export interface TraceSchema extends Named<typeof traceSchemaDefinition> {}
export const traceSchema: TraceSchema = traceSchemaDefinition;

export type Trace = z.infer<typeof traceSchema>;

const lLMModeTraceSchemaDefinition = z.object({
  ...traceSchema.omit({ timestamps: true, indexing_md5s: true }).shape,
  timestamps: z.object({
    started_at: z.string(),
    inserted_at: z.string(),
    updated_at: z.string(),
  }),
  ascii_tree: z.string(),
});
export interface LLMModeTraceSchema extends Named<typeof lLMModeTraceSchemaDefinition> {}
export const lLMModeTraceSchema: LLMModeTraceSchema = lLMModeTraceSchemaDefinition;

export type LLMModeTrace = z.infer<typeof lLMModeTraceSchema>;

// Dead ElasticSearch shape kept as a structural type only (no schema needed).
export type ElasticSearchTrace = Omit<Trace, "metadata" | "timestamps" | "events" | "privacy"> & {
  metadata: ReservedTraceMetadata & {
    custom?: CustomMetadata;
    all_keys?: string[];
  };
  timestamps: Trace["timestamps"] & {
    updated_at: number;
  };

  spans?: ElasticSearchSpan[];
  evaluations?: ElasticSearchEvaluation[];
  events?: ElasticSearchEvent[];
  retention_policy?: "180d" | "365d" | "730d" | null;
  retention_holdouts?: string[] | null;
};

const collectorRESTParamsSchemaDefinition = z.object({
  trace_id: z.union([z.string(), z.undefined()]).optional().nullable(),
  spans: z.array(langWatchSpanSchema),
  metadata: z
    .object({
      user_id: z.union([z.string(), z.undefined()]).optional().nullable(),
      thread_id: z.union([z.string(), z.undefined()]).optional().nullable(),
      customer_id: z.union([z.string(), z.undefined()]).optional().nullable(),
      labels: z
        .union([z.array(z.string()), z.undefined()])
        .optional()
        .nullable(),
      sdk_version: z.union([z.string(), z.undefined()]).optional().nullable(),
      sdk_language: z.union([z.string(), z.undefined()]).optional().nullable(),
    })
    .and(customMetadataSchema)
    .optional(),
  expected_output: z.string().optional().nullable(),
  evaluations: z.array(rESTEvaluationSchema).optional(),
});
export interface CollectorRESTParamsSchema extends Named<
  typeof collectorRESTParamsSchemaDefinition
> {}
export const collectorRESTParamsSchema: CollectorRESTParamsSchema =
  collectorRESTParamsSchemaDefinition;

export type CollectorRESTParams = z.infer<typeof collectorRESTParamsSchema>;

const collectorRESTParamsValidatorSchemaDefinition = collectorRESTParamsSchema.omit({
  spans: true,
});
export interface CollectorRESTParamsValidatorSchema extends Named<
  typeof collectorRESTParamsValidatorSchemaDefinition
> {}
export const collectorRESTParamsValidatorSchema: CollectorRESTParamsValidatorSchema =
  collectorRESTParamsValidatorSchemaDefinition;

export type CollectorRESTParamsValidator = z.infer<typeof collectorRESTParamsValidatorSchema>;

const trackEventRESTParamsValidatorSchemaDefinition = z.object({
  ...langWatchEventSchema.omit({
    event_id: true,
    project_id: true,
    timestamps: true,
    event_details: true,
  }).shape,
  event_id: z.string().optional(), // auto generated unless you want to guarantee idempotency
  event_details: z.record(z.string(), z.string().nullable()).optional(),
  timestamp: z.number().optional(), // The timestamp when the event occurred
});
export interface TrackEventRESTParamsValidatorSchema extends Named<
  typeof trackEventRESTParamsValidatorSchemaDefinition
> {}
export const trackEventRESTParamsValidatorSchema: TrackEventRESTParamsValidatorSchema =
  trackEventRESTParamsValidatorSchemaDefinition;

export type TrackEventRESTParamsValidator = z.infer<typeof trackEventRESTParamsValidatorSchema>;

// Dataset Schemas

export type DatasetSpan =
  | (Omit<BaseSpan, "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"> & {
      params: Record<string, unknown>;
      model?: string | null;
    })
  | (Omit<LLMSpan, "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"> & {
      params: Record<string, unknown>;
      model?: string | null;
    })
  | (Omit<RAGSpan, "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"> & {
      params: Record<string, unknown>;
      model?: string | null;
    });

const datasetSpanShape = {
  params: z.record(z.string(), z.any()),
  model: z.string().optional(),
};

const omittedForDataset = {
  trace_id: true,
  timestamps: true,
  metrics: true,
  params: true,
} as const;

/**
 * The runtime validator for {@link DatasetSpan}: a trace span reduced to what a dataset row
 * carries.
 */
const datasetSpanSchemaDefinition = z.union([
  z.object({ ...baseSpanSchema.omit(omittedForDataset).shape, ...datasetSpanShape }),
  z.object({ ...lLMSpanSchema.omit(omittedForDataset).shape, ...datasetSpanShape }),
  z.object({ ...rAGSpanSchema.omit(omittedForDataset).shape, ...datasetSpanShape }),
]);
export interface DatasetSpanSchema extends Named<typeof datasetSpanSchemaDefinition> {}
export const datasetSpanSchema: DatasetSpanSchema = datasetSpanSchemaDefinition;
