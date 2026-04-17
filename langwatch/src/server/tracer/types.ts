import { z } from "zod";

// --- Zod Schemas (source of truth) ---

export const chatRoleSchema = z.union([
  z.literal("system"),
  z.literal("user"),
  z.literal("assistant"),
  z.literal("function"),
  z.literal("tool"),
  z.literal("unknown"),
]);

export type ChatRole = z.infer<typeof chatRoleSchema>;

export const functionCallSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
});

export type FunctionCall = z.infer<typeof functionCallSchema>;

export const toolCallSchema = z.object({
  id: z.string(),
  type: z.string(),
  function: functionCallSchema,
});

export type ToolCall = z.infer<typeof toolCallSchema>;

export const rAGChunkSchema = z.object({
  document_id: z.string().optional().nullable(),
  chunk_id: z.string().optional().nullable(),
  content: z.union([z.string(), z.record(z.string(), z.any()), z.array(z.any())]),
});

export type RAGChunk = z.infer<typeof rAGChunkSchema>;

export const chatRichContentSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().optional(),
  }),
  z.object({
    type: z.literal("text"),
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
        detail: z
          .union([z.literal("auto"), z.literal("low"), z.literal("high")])
          .optional(),
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
]);

export type ChatRichContent = z.infer<typeof chatRichContentSchema>;

export const chatMessageSchema = z.object({
  role: chatRoleSchema.optional(),
  content: z
    .union([z.string(), z.array(chatRichContentSchema)])
    .optional()
    .nullable(),
  parts: z.array(chatRichContentSchema).optional(),
  function_call: functionCallSchema.optional().nullable(),
  tool_calls: z.array(toolCallSchema).optional().nullable(),
  tool_call_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  reasoning_content: z.string().optional().nullable(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const typedValueChatMessagesSchema = z.object({
  type: z.literal("chat_messages"),
  value: z.array(chatMessageSchema),
});

export type TypedValueChatMessages = z.infer<typeof typedValueChatMessagesSchema>;

export const typedValueTextSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
});

export type TypedValueText = z.infer<typeof typedValueTextSchema>;

export const typedValueRawSchema = z.object({
  type: z.literal("raw"),
  value: z.string(),
});

export type TypedValueRaw = z.infer<typeof typedValueRawSchema>;

export const jSONSerializableSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.string(), z.any()),
    z.array(z.any()),
  ])
  .nullable();

export type JSONSerializable = z.infer<typeof jSONSerializableSchema>;

export const typedValueJsonSchema = z.object({
  type: z.literal("json"),
  value: jSONSerializableSchema,
});

export type TypedValueJson = z.infer<typeof typedValueJsonSchema>;

export const moneySchema = z.object({
  currency: z.string(),
  amount: z.number(),
});

export type Money = z.infer<typeof moneySchema>;

export const evaluationResultSchema = z.object({
  status: z.union([
    z.literal("processed"),
    z.literal("skipped"),
    z.literal("error"),
  ]),
  passed: z.boolean().optional().nullable(),
  score: z.number().optional().nullable(),
  label: z.string().optional().nullable(),
  details: z.string().optional().nullable(),
  cost: moneySchema.optional().nullable(),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

export const typedValueGuardrailResultSchema = z.object({
  type: z.literal("guardrail_result"),
  value: evaluationResultSchema,
});

export type TypedValueGuardrailResult = z.infer<typeof typedValueGuardrailResultSchema>;

export const typedValueEvaluationResultSchema = z.object({
  type: z.literal("evaluation_result"),
  value: evaluationResultSchema,
});

export type TypedValueEvaluationResult = z.infer<typeof typedValueEvaluationResultSchema>;

// SpanInputOutput is recursive — define the type first for the annotation
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

export const spanInputOutputSchema: z.ZodType<SpanInputOutput> = z.lazy(() =>
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
);

export const errorCaptureSchema = z.object({
  has_error: z.literal(true),
  message: z.string(),
  stacktrace: z.array(z.string()),
});

export type ErrorCapture = z.infer<typeof errorCaptureSchema>;

export const spanMetricsSchema = z.object({
  prompt_tokens: z.number().optional().nullable(),
  completion_tokens: z.number().optional().nullable(),
  reasoning_tokens: z.number().optional().nullable(),
  cache_read_input_tokens: z.number().optional().nullable(),
  cache_creation_input_tokens: z.number().optional().nullable(),
  tokens_estimated: z.boolean().optional().nullable(),
  cost: z.number().optional().nullable(),
});

export type SpanMetrics = z.infer<typeof spanMetricsSchema>;

export const reservedSpanParamsSchema = z.object({
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

export type ReservedSpanParams = z.infer<typeof reservedSpanParamsSchema>;

export const spanParamsSchema = reservedSpanParamsSchema.and(z.record(z.string(), z.any()));

export type SpanParams = z.infer<typeof spanParamsSchema>;

export const spanTimestampsSchema = z.object({
  ignore_timestamps_on_write: z.boolean().optional().nullable(),
  started_at: z.number(),
  first_token_at: z.number().optional().nullable(),
  finished_at: z.number(),
});

export type SpanTimestamps = z.infer<typeof spanTimestampsSchema>;

export const spanTypesSchema = z.union([
  z.literal("span"),
  z.literal("llm"),
  z.literal("chain"),
  z.literal("tool"),
  z.literal("agent"),
  z.literal("rag"),
  z.literal("guardrail"),
  z.literal("evaluation"),
  z.literal("workflow"),
  z.literal("component"),
  z.literal("module"),
  z.literal("server"),
  z.literal("client"),
  z.literal("producer"),
  z.literal("consumer"),
  z.literal("task"),
  z.literal("unknown"),
]);

export type SpanTypes = z.infer<typeof spanTypesSchema>;

export const baseSpanSchema = z.object({
  span_id: z.string(),
  parent_id: z.string().optional().nullable(),
  trace_id: z.string(),
  type: spanTypesSchema,
  name: z.string().optional().nullable(),
  input: spanInputOutputSchema.optional().nullable(),
  output: spanInputOutputSchema.optional().nullable(),
  error: errorCaptureSchema.optional().nullable(),
  timestamps: spanTimestampsSchema,
  metrics: spanMetricsSchema.optional().nullable(),
  params: spanParamsSchema.optional().nullable(),
});

export type BaseSpan = z.infer<typeof baseSpanSchema>;

export const lLMSpanSchema = baseSpanSchema.extend({
  type: z.literal("llm"),
  vendor: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
});

export type LLMSpan = z.infer<typeof lLMSpanSchema>;

export const rAGSpanSchema = baseSpanSchema.extend({
  type: z.literal("rag"),
  contexts: z.array(rAGChunkSchema),
});

export type RAGSpan = z.infer<typeof rAGSpanSchema>;

export const spanSchema = z.union([
  lLMSpanSchema,
  rAGSpanSchema,
  baseSpanSchema,
]);

export type Span = z.infer<typeof spanSchema>;

export const spanInputOutputValidatorSchema = spanInputOutputSchema.and(
  z.object({
    value: z.any(),
  }),
);

export type SpanInputOutputValidator = z.infer<typeof spanInputOutputValidatorSchema>;

export const spanValidatorSchema = z
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

export type SpanValidator = z.infer<typeof spanValidatorSchema>;

export const traceInputSchema = z.object({
  value: z.string(),
});

export type TraceInput = z.infer<typeof traceInputSchema>;

export const traceOutputSchema = z.object({
  value: z.string(),
});

export type TraceOutput = z.infer<typeof traceOutputSchema>;

export const primitiveTypeSchema = z
  .union([z.string(), z.number(), z.boolean(), z.undefined()])
  .nullable();

export type PrimitiveType = z.infer<typeof primitiveTypeSchema>;

export const reservedTraceMetadataSchema = z.object({
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

export type ReservedTraceMetadata = z.infer<typeof reservedTraceMetadataSchema>;

export const reservedTraceMetadataMappingSchema = z.record(z.string(), z.any());

export type ReservedTraceMetadataMapping = z.infer<typeof reservedTraceMetadataMappingSchema>;

export const customMetadataSchema = z.record(
  z.string(),
  z.union([
    primitiveTypeSchema,
    z.array(primitiveTypeSchema),
    z.record(z.string(), primitiveTypeSchema),
    z.record(z.string(), z.record(z.string(), primitiveTypeSchema)),
  ]),
);

export type CustomMetadata = z.infer<typeof customMetadataSchema>;

export const traceMetadataSchema =
  reservedTraceMetadataSchema.and(customMetadataSchema);

export type TraceMetadata = z.infer<typeof traceMetadataSchema>;

export const eventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  project_id: z.string(),
  metrics: z.record(z.string(), z.number()),
  event_details: z.record(z.string(), z.string()),
  trace_id: z.string(),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
});

export type Event = z.infer<typeof eventSchema>;

export const elasticSearchEventSchema = eventSchema
  .omit({ metrics: true, event_details: true })
  .and(
    z.object({
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
    }),
  );

export type ElasticSearchEvent = z.infer<typeof elasticSearchEventSchema>;

export const evaluationStatusSchema = z.union([
  z.literal("scheduled"),
  z.literal("in_progress"),
  z.literal("error"),
  z.literal("skipped"),
  z.literal("processed"),
]);

export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

export const evaluationSchema = z.object({
  evaluation_id: z.string(),
  evaluator_id: z.string(),
  span_id: z.string().optional().nullable(),
  name: z.string(),
  type: z.string().optional().nullable(),
  is_guardrail: z.boolean().optional().nullable(),
  evaluation_thread_id: z.string().optional().nullable(),
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

export type Evaluation = z.infer<typeof evaluationSchema>;

export const elasticSearchEvaluationSchema = evaluationSchema;

export type ElasticSearchEvaluation = z.infer<typeof elasticSearchEvaluationSchema>;

export const rESTEvaluationSchema = evaluationSchema
  .omit({
    evaluation_id: true,
    evaluator_id: true,
    status: true,
    timestamps: true,
    retries: true,
  })
  .and(
    z.object({
      evaluation_id: z.string().optional().nullable(),
      evaluator_id: z.string().optional().nullable(),
      status: z
        .union([
          z.literal("processed"),
          z.literal("skipped"),
          z.literal("error"),
        ])
        .optional()
        .nullable(),
      timestamps: z
        .object({
          started_at: z.number().optional().nullable(),
          finished_at: z.number().optional().nullable(),
        })
        .optional()
        .nullable(),
    }),
  );

export type RESTEvaluation = z.infer<typeof rESTEvaluationSchema>;

export const collectorRESTParamsSchema = z.object({
  trace_id: z.union([z.string(), z.undefined()]).optional().nullable(),
  spans: z.array(spanSchema),
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

export type CollectorRESTParams = z.infer<typeof collectorRESTParamsSchema>;

export const collectorRESTParamsValidatorSchema =
  collectorRESTParamsSchema.omit({ spans: true });

export type CollectorRESTParamsValidator = z.infer<typeof collectorRESTParamsValidatorSchema>;

export const trackEventRESTParamsValidatorSchema = eventSchema
  .omit({
    event_id: true,
    project_id: true,
    timestamps: true,
    event_details: true,
  })
  .and(
    z.object({
      event_id: z.string().optional(),
      event_details: z.record(z.string(), z.string().nullable()).optional(),
      timestamp: z.number().optional(),
    }),
  );

export type TrackEventRESTParamsValidator = z.infer<typeof trackEventRESTParamsValidatorSchema>;

export const contextsSchema = z.object({
  traceId: z.string(),
  contexts: z.array(rAGChunkSchema),
});

export type Contexts = z.infer<typeof contextsSchema>;

export const traceSchema = z.object({
  trace_id: z.string(),
  project_id: z.string(),
  metadata: traceMetadataSchema,
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
      total_cost: z.number().optional().nullable(),
      tokens_estimated: z.boolean().optional().nullable(),
    })
    .optional(),
  error: errorCaptureSchema.optional().nullable(),
  indexing_md5s: z.array(z.string()).optional(),
  events: z.array(eventSchema).optional(),
  evaluations: z.array(evaluationSchema).optional(),
  spans: z.array(spanSchema),
});

export type Trace = z.infer<typeof traceSchema>;

export const lLMModeTraceSchema = traceSchema
  .omit({ timestamps: true, indexing_md5s: true })
  .and(
    z.object({
      timestamps: z.object({
        started_at: z.string(),
        inserted_at: z.string(),
        updated_at: z.string(),
      }),
      ascii_tree: z.string(),
    }),
  );

export type LLMModeTrace = z.infer<typeof lLMModeTraceSchema>;

// --- Plain types (no Zod schemas needed) ---

export type ElasticSearchInputOutput = {
  type: SpanInputOutput["type"];
  value: string;
};

export type ElasticSearchSpan = Omit<
  BaseSpan & Partial<Omit<RAGSpan, "type">> & Partial<Omit<LLMSpan, "type">>,
  "input" | "output"
> & {
  project_id: string;
  input?: ElasticSearchInputOutput | null;
  output?: ElasticSearchInputOutput | null;
  timestamps: SpanTimestamps & { inserted_at: number; updated_at: number };
};

export type ElasticSearchTrace = Omit<
  Trace,
  "metadata" | "timestamps" | "events"
> & {
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

export type DatasetSpan =
  | (Omit<
      BaseSpan,
      "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"
    > & { params: Record<string, any>; model?: string | null })
  | (Omit<
      LLMSpan,
      "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"
    > & { params: Record<string, any>; model?: string | null })
  | (Omit<
      RAGSpan,
      "project_id" | "trace_id" | "id" | "timestamps" | "metrics" | "params"
    > & { params: Record<string, any>; model?: string | null });
