import { createLogger } from "@langwatch/observability";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  ESpanKind,
  type Fixed64,
  type IAnyValue,
  type IExportTraceServiceRequest,
  type IInstrumentationScope,
  type IKeyValue,
  type ISpan,
} from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import cloneDeep from "lodash-es/cloneDeep";
import Long from "long";
import { z } from "zod";
import { toError } from "~/utils/posthogErrorCapture";
import type { DeepPartial } from "../../utils/types";
import { openTelemetryToLangWatchMetadataMapping } from "./metadata";
import {
  extractStrandsAgentsInputOutput,
  extractStrandsAgentsMetadata,
  isStrandsAgentsInstrumentation,
} from "./span-event-processing/strands-agents";
import {
  type BaseSpan,
  type ChatMessage,
  type CustomMetadata,
  chatMessageSchema,
  customMetadataSchema,
  type LLMSpan,
  type RAGChunk,
  type RESTEvaluation,
  type ReservedTraceMetadata,
  rESTEvaluationSchema,
  reservedSpanParamsSchema,
  reservedTraceMetadataSchema,
  type Span,
  type SpanTypes,
  spanMetricsSchema,
  spanTimestampsSchema,
  spanTypesSchema,
  type TypedValueChatMessages,
  typedValueChatMessagesSchema,
} from "./types";
import { decodeBase64OpenTelemetryId, decodeOpenTelemetryId } from "./utils";

const logger = createLogger("langwatch.tracer.otel.traces");
const tracer = getLangWatchTracer("langwatch.tracer.otel.traces");

export type TraceForCollection = {
  traceId: string;
  spans: Span[];
  reservedTraceMetadata: ReservedTraceMetadata;
  customMetadata: CustomMetadata;
  evaluations: RESTEvaluation[] | undefined;
};

export const openTelemetryTraceRequestToTracesForCollection = async (
  otelTrace: DeepPartial<IExportTraceServiceRequest>,
): Promise<TraceForCollection[]> => {
  return await tracer.withActiveSpan(
    "openTelemetryTraceRequestToTracesForCollection",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        // A single otelTrace may contain multiple traces with multiple spans each,
        // we need to account for that, that's why it's always one otelTrace to many traces
        decodeOpenTelemetryIds(otelTrace);

        const traceIds = Array.from(
          new Set(
            otelTrace.resourceSpans?.flatMap((resourceSpan) => {
              return (
                resourceSpan?.scopeSpans?.flatMap((scopeSpan) => {
                  return (
                    scopeSpan?.spans?.flatMap(
                      (span) => span?.traceId as string,
                    ) ?? []
                  );
                }) ?? []
              );
            }) ?? [],
          ),
        );

        span.setAttribute("trace.count", traceIds.length);
        span.setAttribute(
          "resourceSpans.count",
          otelTrace.resourceSpans?.length ?? 0,
        );

        const traces: TraceForCollection[] = traceIds.map((traceId) =>
          openTelemetryTraceRequestToTraceForCollection(traceId, {
            resourceSpans: otelTrace.resourceSpans?.filter((resourceSpan) =>
              resourceSpan?.scopeSpans?.some((scopeSpan) =>
                scopeSpan?.spans?.some((span) => span?.traceId === traceId),
              ),
            ),
          }),
        );

        span.setAttribute("processed.traces.count", traces.length);
        return traces;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(toError(error));
        throw error;
      }
    },
  );
};

const OTEL_SPAN_ID_FIELDS = ["traceId", "spanId", "parentSpanId"] as const;

function decodeSpanIds(span: DeepPartial<ISpan> | undefined): void {
  if (!span) return;
  for (const field of OTEL_SPAN_ID_FIELDS) {
    const raw = (span as any)[field];
    if (!raw) continue;
    const decoded =
      typeof raw === "string"
        ? decodeBase64OpenTelemetryId(raw)
        : decodeOpenTelemetryId(raw);
    if (decoded) {
      (span as any)[field] = decoded;
    }
  }
}

const decodeOpenTelemetryIds = (
  otelTrace: DeepPartial<IExportTraceServiceRequest>,
) => {
  for (const resourceSpan of otelTrace.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        decodeSpanIds(span);
      }
    }
  }
};

// telemetry.sdk.* are standard SDK-provenance resource attributes present on
// every OTLP trace, which LangWatch has always surfaced as custom metadata.
// Leave them there to preserve that behaviour and keep this change scoped to
// the trace-identity keys Langy relies on (tag.tags, langwatch.thread.id, ...).
function isReservedResourceAttributeKey(
  key: string,
  value: string | undefined,
): boolean {
  return (
    key in openTelemetryToLangWatchMetadataMapping &&
    !key.startsWith("telemetry.sdk.") &&
    value != null
  );
}

function collectResourceSpanAttributes(
  resourceSpan: any,
  customMetadata: Record<string, any>,
  resourceReservedSource: Record<string, string | string[]>,
): void {
  for (const attribute of resourceSpan?.resource?.attributes ?? []) {
    if (!attribute?.key) continue;
    const value = attribute?.value?.stringValue;
    if (isReservedResourceAttributeKey(attribute.key, value)) {
      resourceReservedSource[attribute.key] = value;
    } else {
      customMetadata[attribute.key] = value;
    }
  }
}

// Collect OTLP resource attributes (shared by every span in the request).
// Reserved keys (tag.tags -> labels, langwatch.thread.id -> thread_id, ...)
// are hoisted to reserved trace metadata exactly as they are from span
// attributes — Langy's opencode OTel plugin sets them on the resource, so
// this is what makes its traces land labeled "langy" and grouped by
// conversation. Everything else stays custom.
function collectResourceMetadata(
  otelTrace: DeepPartial<IExportTraceServiceRequest>,
): {
  customMetadata: Record<string, any>;
  resourceReservedSource: Record<string, string | string[]>;
} {
  const customMetadata: Record<string, any> = {};
  const resourceReservedSource: Record<string, string | string[]> = {};
  for (const resourceSpan of otelTrace.resourceSpans ?? []) {
    collectResourceSpanAttributes(
      resourceSpan,
      customMetadata,
      resourceReservedSource,
    );
  }
  return { customMetadata, resourceReservedSource };
}

function applyResourceReservedMetadata(
  trace: TraceForCollection,
  resourceReservedSource: Record<string, string | string[]>,
): void {
  if (Object.keys(resourceReservedSource).length === 0) return;

  // tag.tags maps to labels (string[]); a resource attribute carries
  // it as a single string (OTEL_RESOURCE_ATTRIBUTES can't express
  // arrays), so coerce to an array before the reserved schema
  // validates it.
  if (typeof resourceReservedSource["tag.tags"] === "string") {
    resourceReservedSource["tag.tags"] = resourceReservedSource["tag.tags"]
      .split(",")
      .map((tag: string) => tag.trim())
      .filter(Boolean);
  }
  try {
    const { reservedTraceMetadata, customMetadata: extraCustom } =
      extractReservedAndCustomMetadata(
        applyMappingsToMetadata(resourceReservedSource),
      );
    trace.reservedTraceMetadata = reservedTraceMetadata;
    // Any reserved-source key the schema didn't claim falls back to
    // custom metadata rather than being dropped.
    Object.assign(trace.customMetadata, extraCustom);
  } catch {
    // Defensive: never let a malformed resource attribute break
    // ingestion — keep the raw values as custom metadata.
    Object.assign(trace.customMetadata, resourceReservedSource);
  }
}

function addSpansForScope(
  trace: TraceForCollection,
  scopeSpan: any,
  traceId: string,
): void {
  for (const span of scopeSpan?.spans ?? []) {
    if (span?.traceId === traceId) {
      addOpenTelemetrySpanAsSpan(trace, span, scopeSpan?.scope);
    }
  }
}

function addSpansForTrace(
  trace: TraceForCollection,
  otelTrace: DeepPartial<IExportTraceServiceRequest>,
  traceId: string,
): void {
  for (const resourceSpan of otelTrace.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      addSpansForScope(trace, scopeSpan, traceId);
    }
  }
}

const openTelemetryTraceRequestToTraceForCollection = (
  traceId: string,
  otelTrace_: DeepPartial<IExportTraceServiceRequest>,
): TraceForCollection => {
  return tracer.withActiveSpan(
    "openTelemetryTraceRequestToTraceForCollection",
    { kind: SpanKind.INTERNAL },
    (span) => {
      try {
        span.setAttribute("trace.id", traceId);
        span.setAttribute(
          "resourceSpans.count",
          otelTrace_.resourceSpans?.length ?? 0,
        );
        const otelTrace = cloneDeep(otelTrace_);

        const { customMetadata, resourceReservedSource } =
          collectResourceMetadata(otelTrace);

        const trace: TraceForCollection = {
          traceId,
          spans: [],
          evaluations: [],
          reservedTraceMetadata: {},
          customMetadata,
        };

        applyResourceReservedMetadata(trace, resourceReservedSource);

        addSpansForTrace(trace, otelTrace, traceId);

        span.setAttribute("spans.count", trace.spans.length);
        span.setAttribute("evaluations.count", trace.evaluations?.length ?? 0);
        span.setAttribute(
          "customMetadata.keys",
          Object.keys(trace.customMetadata).length,
        );

        return trace;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(toError(error));
        throw error;
      }
    },
  );
};

const allowedSpanTypes = spanTypesSchema.options.map((option) => option.value);

const parseTimestamp = (
  timestamp: DeepPartial<Fixed64> | undefined,
): number | undefined => {
  const unixNano =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? parseInt(timestamp, 10)
        : maybeConvertLongBits(timestamp);

  return unixNano ? Math.round(unixNano / 1000 / 1000) : undefined;
};

// Mutable accumulator threaded through the span-building pipeline below.
// Every extraction/inference step below takes this single object so each
// step stays a one-parameter function while still reading/writing the same
// shared state the original inline implementation closed over.
type SpanBuildState = {
  readonly incomingSpan: DeepPartial<ISpan>;
  readonly incomingScope: DeepPartial<IInstrumentationScope> | undefined;
  readonly attributesMap: Record<string, any>;
  readonly trace: TraceForCollection;
  type: Span["type"];
  model: LLMSpan["model"];
  input: LLMSpan["input"];
  output: LLMSpan["output"];
  params: Span["params"];
  metadata: Record<string, unknown>;
  started_at: Span["timestamps"]["started_at"] | undefined;
  finished_at: Span["timestamps"]["finished_at"] | undefined;
  first_token_at: Span["timestamps"]["first_token_at"];
  error: Span["error"];
  metrics: LLMSpan["metrics"];
  contexts: RAGChunk[];
  name: string | undefined;
};

function recordCustomEvaluationEvent(
  event: NonNullable<DeepPartial<ISpan>["events"]>[number],
  trace: TraceForCollection,
): void {
  const jsonPayload = event.attributes?.find(
    (attr) => attr?.key === "json_encoded_event",
  )?.value?.stringValue;
  if (!jsonPayload) {
    logger.warn(
      { event },
      "event for `langwatch.evaluation.custom` has no json_encoded_event",
    );
    return;
  }

  try {
    const parsedJsonPayload = JSON.parse(jsonPayload);
    const evaluation = rESTEvaluationSchema.parse(parsedJsonPayload);

    if (!trace.evaluations) trace.evaluations = [];
    trace.evaluations.push(evaluation);
  } catch (error) {
    logger.error(
      { error, jsonPayload },
      "error parsing json_encoded_event from `langwatch.evaluation.custom`, event discarded",
    );
  }
}

function updateFirstTokenAtFromTimingEvent(
  state: SpanBuildState,
  event: NonNullable<DeepPartial<ISpan>["events"]>[number],
): void {
  const ts = parseTimestamp(event?.timeUnixNano);
  if (ts && (!state.first_token_at || ts < state.first_token_at)) {
    state.first_token_at = ts;
  }
}

// First token at
function computeFirstTokenAtFromEvents(state: SpanBuildState): void {
  for (const event of state.incomingSpan?.events ?? []) {
    if (!event) continue;

    switch (event.name) {
      case "First Token Stream Event":
      case "llm.content.completion.chunk": {
        updateFirstTokenAtFromTimingEvent(state, event);
        break;
      }
      case "langwatch.evaluation.custom": {
        recordCustomEvaluationEvent(event, state.trace);
        break;
      }

      default:
        break;
    }
  }
}

// Special handling for strands-agents Python SDK
function applyStrandsAgentsInputOutput(state: SpanBuildState): void {
  if (
    !isStrandsAgentsInstrumentation(state.incomingScope, state.incomingSpan)
  ) {
    return;
  }
  const io = extractStrandsAgentsInputOutput(state.incomingSpan);
  if (io) {
    state.input = io.input;
    state.output = io.output;
  }
}

function applyFirstTokenAtFromAttributes(state: SpanBuildState): void {
  const { attributesMap, started_at } = state;
  if (started_at && attributesMap.gen_ai?.server?.time_to_first_token) {
    state.first_token_at =
      started_at +
      parseInt((attributesMap as any).gen_ai.server.time_to_first_token, 10);
  }

  if (started_at && attributesMap.ai?.response?.msToFirstChunk) {
    state.first_token_at =
      started_at +
      parseInt((attributesMap as any).ai.response.msToFirstChunk, 10);
  }
}

const SPAN_KIND_TYPE_MAP: Array<{
  stringKind: string;
  enumKind: ESpanKind;
  type: SpanTypes;
}> = [
  {
    stringKind: "SPAN_KIND_SERVER",
    enumKind: ESpanKind.SPAN_KIND_SERVER,
    type: "server",
  },
  {
    stringKind: "SPAN_KIND_CLIENT",
    enumKind: ESpanKind.SPAN_KIND_CLIENT,
    type: "client",
  },
  {
    stringKind: "SPAN_KIND_PRODUCER",
    enumKind: ESpanKind.SPAN_KIND_PRODUCER,
    type: "producer",
  },
  {
    stringKind: "SPAN_KIND_CONSUMER",
    enumKind: ESpanKind.SPAN_KIND_CONSUMER,
    type: "consumer",
  },
];

function applySpanKindType(state: SpanBuildState): void {
  const kind = state.incomingSpan.kind;
  for (const { stringKind, enumKind, type } of SPAN_KIND_TYPE_MAP) {
    if ((kind as any) === stringKind || kind === enumKind) {
      state.type = type;
    }
  }
}

function applyVendorSpanKindType(
  attributesMap: Record<string, any>,
  vendorKey: "openinference" | "traceloop",
): SpanTypes | undefined {
  const kind_ = attributesMap[vendorKey]?.span?.kind;
  if (!kind_) return undefined;
  const normalized = kind_.toLowerCase();
  if (!allowedSpanTypes.includes(normalized as SpanTypes)) return undefined;
  delete attributesMap[vendorKey].span.kind;
  return normalized as SpanTypes;
}

function applyOpeninferenceAndTraceloopSpanKindType(
  state: SpanBuildState,
): void {
  for (const vendorKey of ["openinference", "traceloop"] as const) {
    const inferred = applyVendorSpanKindType(state.attributesMap, vendorKey);
    if (inferred) {
      state.type = inferred;
    }
  }
}

function applyGenericTypeAttribute(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (attributesMap?.type) {
    state.type = attributesMap.type as SpanTypes;
    attributesMap.type = void 0;
  }
}

function applyLlmRequestTypeAndVercelAndToolType(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    attributesMap.llm?.request?.type === "chat" ||
    attributesMap.llm?.request?.type === "completion"
  ) {
    state.type = "llm";
    delete attributesMap.llm.request.type;
  }
  // vercel
  if (attributesMap.ai && attributesMap.gen_ai) {
    state.type = "llm";
  }
  if (attributesMap.operation?.name === "ai.toolCall") {
    state.type = "tool";
  }
}

// Agents
function applyAgentType(state: SpanBuildState): void {
  const { attributesMap, incomingSpan } = state;
  if (attributesMap.gen_ai?.agent || attributesMap.agent?.name) {
    // Strands agent
    if (incomingSpan.name === "Model invoke") {
      state.type = "llm";
    } else {
      state.type = "agent";
    }
  }
}

// GenAI semantic convention chat LLM calls (Strands, OpenClaw, etc.)
// CLIENT span kind is standard for gen_ai LLM calls per the OTEL GenAI spec
function applyGenAiOperationNameType(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    (state.type === "span" || state.type === "client") &&
    attributesMap.gen_ai?.operation?.name === "chat"
  ) {
    state.type = "llm";
  }
  if (
    (state.type === "span" || state.type === "client") &&
    attributesMap.gen_ai?.operation?.name === "tool"
  ) {
    state.type = "tool";
  }
}

// Type
function inferSpanType(state: SpanBuildState): void {
  applySpanKindType(state);
  applyOpeninferenceAndTraceloopSpanKindType(state);
  applyGenericTypeAttribute(state);
  applyLlmRequestTypeAndVercelAndToolType(state);
  applyAgentType(state);
  applyGenAiOperationNameType(state);
}

// Extract metadata for agent spans from strands-agents
function applyStrandsAgentMetadataForAgentType(state: SpanBuildState): void {
  if (
    state.type !== "agent" ||
    !isStrandsAgentsInstrumentation(state.incomingScope, state.incomingSpan)
  ) {
    return;
  }
  const strandsMetadata = extractStrandsAgentsMetadata(state.incomingSpan);
  if (Object.keys(strandsMetadata).length > 0) {
    state.metadata = {
      ...state.metadata,
      ...strandsMetadata,
    };
  }
}

// infer for others otel gen_ai spec
function applyGenAiResponseModelType(state: SpanBuildState): void {
  if (
    (state.type === "span" || state.type === "client") &&
    state.attributesMap.gen_ai?.response?.model
  ) {
    state.type = "llm";
  }
}

// Model
function inferModel(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (attributesMap.llm?.model_name) {
    state.model = (attributesMap as any).llm.model_name;
    attributesMap.llm.model_name = void 0;
  }

  if (attributesMap.gen_ai?.request?.model) {
    state.model = (attributesMap as any).gen_ai.request.model;
    attributesMap.gen_ai.request.model = void 0;
  }

  if (attributesMap.gen_ai?.response?.model) {
    state.model = (attributesMap as any).gen_ai.response.model;
    attributesMap.gen_ai.response.model = void 0;
  }

  if (
    attributesMap.gen_ai &&
    attributesMap.ai?.model &&
    typeof attributesMap.ai.model === "object" &&
    typeof (attributesMap.ai.model as any).id === "string"
  ) {
    const provider =
      (attributesMap.ai.model as any).provider?.split(".")[0] ?? "";
    state.model = [provider, (attributesMap as any).ai.model.id]
      .filter(Boolean)
      .join("/");
    delete attributesMap.ai.model;
  }
}

// GenAI semantic convention: gen_ai.input.messages (e.g. OpenClaw, OTEL GenAI spec)
// We assign directly as chat_messages without Zod validation to avoid
// stripping content fields that use provider-specific formats (e.g.
// Anthropic tool_use/tool_result content blocks).
function applyGenAiInputMessages(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.input &&
    attributesMap.gen_ai?.input?.messages &&
    Array.isArray(attributesMap.gen_ai.input.messages)
  ) {
    const messages: ChatMessage[] = [];
    // Prepend system instructions as a system message
    if (attributesMap.gen_ai?.system_instructions) {
      const raw = attributesMap.gen_ai.system_instructions;
      // Keep the original value shape: string stays string, array stays array
      const sysContent =
        typeof raw === "string"
          ? raw
          : (raw as unknown as ChatMessage["content"]);
      messages.push({ role: "system", content: sysContent });
      delete (attributesMap as any).gen_ai.system_instructions;
    }
    messages.push(...(attributesMap.gen_ai.input.messages as ChatMessage[]));
    state.input = { type: "chat_messages", value: messages };
    delete (attributesMap as any).gen_ai.input.messages;
  }
}

function applyLlmInputMessages(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    attributesMap.llm?.input_messages &&
    Array.isArray(attributesMap.llm.input_messages)
  ) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.llm.input_messages.map(
        (message: { message?: string }) => message.message,
      ),
    });

    if (input_.success) {
      state.input = input_.data as TypedValueChatMessages;
      delete attributesMap.llm.input_messages;
    }
  }
}

function applyGenAiPromptArrayInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.input &&
    attributesMap.gen_ai?.prompt &&
    Array.isArray(attributesMap.gen_ai.prompt)
  ) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.gen_ai.prompt,
    });

    if (input_.success) {
      state.input = input_.data as TypedValueChatMessages;
    } else {
      state.input = {
        type: "json",
        value: attributesMap.gen_ai.prompt,
      };
    }
    delete attributesMap.gen_ai.prompt;
  }
}

function applyGenAiPromptStringInput(state: SpanBuildState): void {
  const { attributesMap, trace } = state;
  if (!state.input && typeof attributesMap.gen_ai?.prompt === "string") {
    try {
      const parsed = JSON.parse(attributesMap.gen_ai.prompt);
      state.input = {
        type: "json",
        value: parsed,
      };
    } catch (error) {
      logger.error(
        {
          error,
          customerTraceId: trace.traceId,
        },
        "error parsing gen_ai.prompt",
      );

      state.output = {
        type: "text",
        value: attributesMap.gen_ai.prompt,
      };
    }
    delete attributesMap.gen_ai.prompt;
  }
}

function applyGenAiPromptMessagesInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.input &&
    attributesMap.gen_ai?.prompt?.messages &&
    Array.isArray(attributesMap.gen_ai.prompt.messages)
  ) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.gen_ai.prompt.messages,
    });

    if (input_.success) {
      state.input = input_.data as TypedValueChatMessages;
      delete attributesMap.gen_ai.prompt;
    } else {
      state.input = {
        type: "json",
        value: attributesMap.gen_ai.prompt.messages,
      };
    }
  }
}

// vercel
function applyVercelPromptMessagesInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.input &&
    attributesMap.ai?.prompt?.messages &&
    Array.isArray(attributesMap.ai.prompt.messages)
  ) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.ai.prompt.messages,
    });

    if (input_.success) {
      state.input = input_.data as TypedValueChatMessages;
      delete attributesMap.ai.prompt;
    }
  }
}

function applyVercelToolCallArgsInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.input &&
    state.type === "tool" &&
    attributesMap.ai?.toolCall?.args
  ) {
    state.input = {
      type: "json",
      value: attributesMap.ai?.toolCall?.args,
    };
  }
}

function applyTraceloopEntityInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.input && attributesMap.traceloop?.entity?.input) {
    state.input =
      typeof attributesMap.traceloop.entity.input === "string"
        ? {
            type: "text",
            value: attributesMap.traceloop.entity.input,
          }
        : {
            type: "json",
            value: attributesMap.traceloop.entity.input,
          };

    // Check for langchain metadata inside traceloop https://github.com/traceloop/openllmetry/issues/1783
    const json = attributesMap.traceloop.entity.input;
    if (
      state.input.type === "json" &&
      typeof json === "object" &&
      json !== null &&
      "metadata" in json &&
      // @ts-ignore
      typeof json.metadata === "object" &&
      // @ts-ignore
      !Array.isArray(json.metadata)
    ) {
      state.metadata = {
        ...state.metadata,
        ...json.metadata,
      };

      json.metadata = void 0;
    }

    attributesMap.traceloop.entity.input = void 0;
  }
}

// Check for vercel metadata
function applyVercelTelemetryMetadata(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    attributesMap.ai?.telemetry?.metadata &&
    typeof attributesMap.ai.telemetry.metadata === "object"
  ) {
    state.metadata = {
      ...state.metadata,
      ...attributesMap.ai.telemetry.metadata,
    };

    attributesMap.ai.telemetry.metadata = void 0;
  }
}

function applyGenericAttributesInputValue(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.input && attributesMap.input?.value) {
    state.input =
      typeof attributesMap.input.value === "string"
        ? {
            type: "text",
            value: attributesMap.input.value,
          }
        : {
            type: "json",
            value: attributesMap.input.value,
          };
  }
  delete attributesMap.input;
}

function applyCrewInputsInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.input && attributesMap.crew_inputs) {
    state.input = {
      type: "json",
      value: attributesMap.crew_inputs,
    };
  }
}

// logfire
function applyRawInputInput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.input && attributesMap.raw_input) {
    state.input = {
      type: "chat_messages",
      value: attributesMap.raw_input as any,
    };
  }
}

// Input
function extractSpanInput(state: SpanBuildState): void {
  applyGenAiInputMessages(state);
  applyLlmInputMessages(state);
  applyGenAiPromptArrayInput(state);
  applyGenAiPromptStringInput(state);
  applyGenAiPromptMessagesInput(state);
  applyVercelPromptMessagesInput(state);
  applyVercelToolCallArgsInput(state);
  applyTraceloopEntityInput(state);
  applyVercelTelemetryMetadata(state);
  applyGenericAttributesInputValue(state);
  applyCrewInputsInput(state);
  applyRawInputInput(state);
}

// GenAI semantic convention: gen_ai.output.messages (e.g. OpenClaw, OTEL GenAI spec)
// Assign directly without Zod validation to preserve all content fields.
function applyGenAiOutputMessages(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.output &&
    attributesMap.gen_ai?.output?.messages &&
    Array.isArray(attributesMap.gen_ai.output.messages)
  ) {
    state.output = {
      type: "chat_messages",
      value: attributesMap.gen_ai.output.messages as ChatMessage[],
    };
    delete (attributesMap as any).gen_ai.output.messages;
  }
}

function applyLlmOutputMessagesArray(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    attributesMap.llm?.output_messages &&
    Array.isArray(attributesMap.llm.output_messages)
  ) {
    const output_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.llm.output_messages.map(
        (message: { message?: string }) => message.message,
      ),
    });

    if (output_.success) {
      state.output = output_.data as TypedValueChatMessages;
      delete attributesMap.llm.output_messages;
    }
  }
}

function applyGenAiCompletionArrayOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.output &&
    attributesMap.gen_ai?.completion &&
    Array.isArray(attributesMap.gen_ai.completion)
  ) {
    const output_ = z
      .object({
        type: z.literal("chat_messages"),
        value: z.array(chatMessageSchema.strict()),
      })
      .safeParse({
        type: "chat_messages",
        value: attributesMap.gen_ai.completion,
      });

    if (
      output_.success &&
      output_.data.value.length > 0 &&
      Object.keys(output_.data.value[0]!).length > 0
    ) {
      state.output = output_.data as TypedValueChatMessages;
    } else {
      state.output = {
        type: "json",
        value: attributesMap.gen_ai.completion,
      };
    }
    delete attributesMap.gen_ai.completion;
  }
}

function applyGenAiCompletionNonArrayOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !state.output &&
    attributesMap.gen_ai?.completion &&
    !Array.isArray(attributesMap.gen_ai.completion)
  ) {
    state.output = {
      type: "json",
      value: attributesMap.gen_ai.completion,
    };
    delete attributesMap.gen_ai.completion;
  }
}

function applyGenAiCompletionStringOutput(state: SpanBuildState): void {
  const { attributesMap, trace } = state;
  if (!state.output && typeof attributesMap.gen_ai?.completion === "string") {
    try {
      const parsed = JSON.parse(attributesMap.gen_ai.completion);
      state.output = {
        type: "json",
        value: parsed,
      };
    } catch (error) {
      logger.error(
        {
          error,
          customerTraceId: trace.traceId,
        },
        "error parsing gen_ai.completion",
      );

      state.output = {
        type: "text",
        value: attributesMap.gen_ai.completion,
      };
    }
    delete attributesMap.gen_ai.completion;
  }
}

// vercel
function applyVercelResponseOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.output && attributesMap.ai?.response) {
    const messages_: ChatMessage[] = [];
    if (attributesMap.ai.response.text) {
      messages_.push({
        role: "assistant",
        content: (attributesMap as any).ai.response.text,
      });
    }
    if (attributesMap.ai.response.toolCalls) {
      messages_.push({
        tool_calls: (attributesMap as any).ai.response.toolCalls,
      });
    }

    if (messages_.length > 0) {
      state.output = {
        type: "chat_messages",
        value: messages_,
      };
    }
  }
}

function applyVercelResponseObjectOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.output && attributesMap.ai?.response?.object) {
    state.output = {
      type: "json",
      value: (attributesMap as any).ai.response.object,
    };
    delete (attributesMap as any).ai.response.object;
  }
}

function applyLlmOutputMessagesFallback(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.output && attributesMap.llm?.output_messages) {
    state.output =
      typeof attributesMap.llm.output_messages === "string"
        ? {
            type: "text",
            value: (attributesMap as any).llm.output_messages,
          }
        : {
            type: "json",
            value: (attributesMap as any).llm.output_messages,
          };
    delete (attributesMap as any).llm.output_messages;
  }
}

function applyTraceloopEntityOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.output && attributesMap.traceloop?.entity?.output) {
    state.output =
      typeof attributesMap.traceloop.entity.output === "string"
        ? {
            type: "text",
            value: (attributesMap as any).traceloop.entity.output,
          }
        : {
            type: "json",
            value: (attributesMap as any).traceloop.entity.output,
          };
    delete (attributesMap as any).traceloop.entity.output;
  }
}

function applyGenericAttributesOutputValue(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!state.output && attributesMap.output?.value) {
    state.output =
      typeof attributesMap.output.value === "string"
        ? {
            type: "text",
            value: (attributesMap as any).output.value,
          }
        : {
            type: "json",
            value: (attributesMap as any).output.value,
          };
  }
  delete (attributesMap as any).output;
}

// logfire
function applyLogfireEventOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (state.output) return;
  if (!Array.isArray(attributesMap?.events)) return;

  // event && typeof event === "object" -> this is needed as `null` is typeof object!
  const event = attributesMap.events.find(
    (event) =>
      event &&
      typeof event === "object" &&
      event["event.name"] === "gen_ai.choice",
  );
  if (event?.message) {
    state.output = {
      type: "chat_messages",
      value: [event.message],
    };
  }
}

// Output
function extractSpanOutput(state: SpanBuildState): void {
  applyGenAiOutputMessages(state);
  applyLlmOutputMessagesArray(state);
  applyGenAiCompletionArrayOutput(state);
  applyGenAiCompletionNonArrayOutput(state);
  applyGenAiCompletionStringOutput(state);
  applyVercelResponseOutput(state);
  applyVercelResponseObjectOutput(state);
  applyLlmOutputMessagesFallback(state);
  applyTraceloopEntityOutput(state);
  applyGenericAttributesOutputValue(state);
  applyLogfireEventOutput(state);
}

function mergeAttributesMetadata(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    attributesMap.metadata &&
    typeof attributesMap.metadata === "object" &&
    !Array.isArray(attributesMap.metadata)
  ) {
    state.metadata = {
      ...state.metadata,
      ...(attributesMap as any).metadata,
    };

    attributesMap.metadata = void 0;
  }
}

function extractVercelUsageMetrics(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!attributesMap.ai?.usage) return;

  if (typeof attributesMap.ai.usage.promptTokens === "number") {
    state.metrics.prompt_tokens = attributesMap.ai.usage.promptTokens;
    delete attributesMap.ai.usage.promptTokens;
  }
  if (typeof attributesMap.ai.usage.completionTokens === "number") {
    state.metrics.completion_tokens = attributesMap.ai.usage.completionTokens;
    delete attributesMap.ai.usage.completionTokens;
  }
}

function extractGenAiPromptCompletionTokens(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (typeof attributesMap.gen_ai.usage.prompt_tokens === "number") {
    state.metrics.prompt_tokens = attributesMap.gen_ai.usage.prompt_tokens;
  }
  if (typeof attributesMap.gen_ai.usage.completion_tokens === "number") {
    state.metrics.completion_tokens =
      attributesMap.gen_ai.usage.completion_tokens;
  }
  // Spring AI
  if (
    attributesMap.gen_ai.usage.input_tokens &&
    !isNaN(Number(attributesMap.gen_ai.usage.input_tokens))
  ) {
    state.metrics.prompt_tokens = Number(
      attributesMap.gen_ai.usage.input_tokens,
    );
  }
  if (
    attributesMap.gen_ai.usage.output_tokens &&
    !isNaN(Number(attributesMap.gen_ai.usage.output_tokens))
  ) {
    state.metrics.completion_tokens = Number(
      attributesMap.gen_ai.usage.output_tokens,
    );
  }
}

function extractGenAiReasoningAndCacheTokens(state: SpanBuildState): void {
  const { attributesMap } = state;
  // Reasoning tokens (Traceloop/OpenLLMetry convention: gen_ai.usage.reasoning_tokens)
  if (
    attributesMap.gen_ai.usage.reasoning_tokens != null &&
    !isNaN(Number(attributesMap.gen_ai.usage.reasoning_tokens))
  ) {
    state.metrics.reasoning_tokens = Number(
      attributesMap.gen_ai.usage.reasoning_tokens,
    );
  }
  // Cache tokens (OTEL semconv: gen_ai.usage.cache_read.input_tokens / gen_ai.usage.cache_creation.input_tokens)
  if (
    attributesMap.gen_ai.usage.cache_read?.input_tokens != null &&
    !isNaN(Number(attributesMap.gen_ai.usage.cache_read.input_tokens))
  ) {
    state.metrics.cache_read_input_tokens = Number(
      attributesMap.gen_ai.usage.cache_read.input_tokens,
    );
  }
  if (
    attributesMap.gen_ai.usage.cache_creation?.input_tokens != null &&
    !isNaN(Number(attributesMap.gen_ai.usage.cache_creation.input_tokens))
  ) {
    state.metrics.cache_creation_input_tokens = Number(
      attributesMap.gen_ai.usage.cache_creation.input_tokens,
    );
  }
}

function extractGenAiUsageMetrics(state: SpanBuildState): void {
  if (!state.attributesMap.gen_ai?.usage) return;

  extractGenAiPromptCompletionTokens(state);
  extractGenAiReasoningAndCacheTokens(state);
}

// Metrics
function extractMetrics(state: SpanBuildState): void {
  extractVercelUsageMetrics(state);
  extractGenAiUsageMetrics(state);
}

// Params
function extractInvocationParams(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (attributesMap.llm?.invocation_parameters) {
    state.params = {
      ...state.params,
      ...(attributesMap.llm.invocation_parameters as Record<string, any>),
    };
    delete attributesMap.llm.invocation_parameters;
  }

  if (attributesMap.llm?.is_streaming) {
    state.params = {
      ...state.params,
      stream:
        attributesMap.llm.is_streaming &&
        attributesMap.llm.is_streaming !== "false" &&
        attributesMap.llm.is_streaming !== "False",
    };
    delete attributesMap.llm.is_streaming;
  }
}

function extractReservedIdsFromAttributes(state: SpanBuildState): void {
  const { attributesMap, trace } = state;
  if (attributesMap.user?.id && typeof attributesMap.user.id === "string") {
    trace.reservedTraceMetadata.user_id = attributesMap.user.id;
    delete attributesMap.user.id;
  }
  if (
    attributesMap.session?.id &&
    typeof attributesMap.session.id === "string"
  ) {
    trace.reservedTraceMetadata.thread_id = attributesMap.session.id;
    delete attributesMap.session.id;
  }
  if (
    attributesMap.gen_ai?.conversation?.id &&
    typeof attributesMap.gen_ai.conversation.id === "string"
  ) {
    trace.reservedTraceMetadata.thread_id =
      attributesMap.gen_ai.conversation.id;
    delete attributesMap.gen_ai.conversation.id;
  }
  if (attributesMap.tag?.tags && Array.isArray(attributesMap.tag.tags)) {
    trace.reservedTraceMetadata.labels = attributesMap.tag.tags;
    delete attributesMap.tag.tags;
  }
}

// vercel
function extractVercelToolParams(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (attributesMap.ai?.prompt?.tools) {
    state.params = {
      ...state.params,
      tools: attributesMap.ai.prompt.tools as any,
    };
    delete attributesMap.ai.prompt.tools;
  }

  if (attributesMap.ai?.prompt?.toolsChoice) {
    state.params = {
      ...state.params,
      tool_choice: attributesMap.ai.prompt.toolsChoice as any,
    };
    delete attributesMap.ai.prompt.toolsChoice;
  }
}

function buildExceptionSpanError(
  state: SpanBuildState,
  event: NonNullable<DeepPartial<ISpan>["events"]>[number],
): Span["error"] {
  const eventAttributes = otelAttributesToNestedAttributes(event?.attributes);

  let errorMessage: string;
  if (eventAttributes.exception?.message && eventAttributes.exception?.type) {
    errorMessage = `${eventAttributes.exception.type}: ${eventAttributes.exception.message}`;
  } else if (state.incomingSpan.status?.message) {
    errorMessage = state.incomingSpan.status.message;
  } else {
    errorMessage = "Unknown Exception Occurred";
  }

  return {
    has_error: true,
    message: errorMessage,
    stacktrace: eventAttributes.exception?.stacktrace
      ? (eventAttributes.exception?.stacktrace as string).split("\n")
      : [],
  };
}

// Exception
function extractSpanError(state: SpanBuildState): void {
  const { incomingSpan } = state;
  if (
    (incomingSpan.status?.code as any) === "STATUS_CODE_ERROR" ||
    (incomingSpan.status?.code as any) === 2 // EStatusCode.STATUS_CODE_ERROR
  ) {
    state.error = {
      has_error: true,
      message: incomingSpan.status?.message ?? "Exception",
      stacktrace: [],
    };
  }

  for (const event of incomingSpan?.events ?? []) {
    if (event?.name === "exception") {
      state.error = buildExceptionSpanError(state, event);
    }
  }
}

// Name
// CrewAI's "Task._execute_core" span names itself after the executing agent
// role, embedded in the input as `agent="...role='<role>'..."`.
function resolveCrewAiTaskAgentName(
  name: string | undefined,
  input: LLMSpan["input"],
): string | undefined {
  if (name !== "Task._execute_core" || !(input?.value as any)?.agent) {
    return name;
  }
  try {
    return (input?.value as any).agent.match(/role='(.*?)'/)?.[1] ?? name;
  } catch {
    /* this is just a safe json parse fallback */
    return name;
  }
}

function inferSpanName(state: SpanBuildState): void {
  const { attributesMap, incomingSpan } = state;
  let name = resolveCrewAiTaskAgentName(incomingSpan.name, state.input);

  // vercel
  if (!name && state.type === "llm" && attributesMap.gen_ai && state.model) {
    name = state.model;
  }
  if (state.type === "tool" && attributesMap.ai?.toolCall?.name) {
    name = (attributesMap as any).ai.toolCall.name;
  }
  // Agent
  if (!name && attributesMap.gen_ai?.agent?.name) {
    name = (attributesMap as any).gen_ai.agent.name;
  }

  state.name = name;
}

// haystack RAG
function extractHaystackRagContexts(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (Array.isArray((attributesMap.retrieval as any)?.documents)) {
    state.type = "rag";
    for (const document of (attributesMap.retrieval as any).documents) {
      const document_ = document.document;
      if (document_?.content) {
        state.contexts.push({
          ...(document_.id ? { document_id: document_.id } : {}),
          content: document_.content,
        });
      }
    }
  }
}

function applyLangwatchSpanType(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (attributesMap.langwatch.span?.type) {
    state.type = (attributesMap as any).langwatch.span.type;
    (attributesMap as any).langwatch.span.type = void 0;
  }
}

function applyLangwatchReservedIds(state: SpanBuildState): void {
  const { attributesMap, trace } = state;
  if (typeof attributesMap.langwatch.thread?.id === "string") {
    trace.reservedTraceMetadata.thread_id = attributesMap.langwatch.thread.id;
    (attributesMap as any).langwatch.thread.id = void 0;
  }
  if (typeof attributesMap.langwatch.user?.id === "string") {
    trace.reservedTraceMetadata.user_id = attributesMap.langwatch.user.id;
    (attributesMap as any).langwatch.user.id = void 0;
  }
  if (typeof attributesMap.langwatch.customer?.id === "string") {
    trace.reservedTraceMetadata.customer_id =
      attributesMap.langwatch.customer.id;
    (attributesMap as any).langwatch.customer.id = void 0;
  }
}

function applyLangwatchLabels(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (Array.isArray(attributesMap.langwatch.labels)) {
    state.metadata = {
      ...state.metadata,
      labels: attributesMap.langwatch.labels,
    };
    (attributesMap as any).langwatch.labels = void 0;
  }
  // Backward compatibility for legacy "langwatch.tags" attribute
  if (
    !state.metadata.labels &&
    Array.isArray((attributesMap as any).langwatch.tags)
  ) {
    state.metadata = {
      ...state.metadata,
      labels: (attributesMap as any).langwatch.tags,
    };
    (attributesMap as any).langwatch.tags = void 0;
  }
}

function applyLangwatchInputOutput(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (attributesMap.langwatch.input) {
    if (
      Array.isArray(attributesMap.langwatch.input) &&
      attributesMap.langwatch.input.length === 1
    ) {
      state.input = (attributesMap as any).langwatch.input[0];
    } else {
      state.input = (attributesMap as any).langwatch.input;
    }
    (attributesMap as any).langwatch.input = void 0;
  }
  if (attributesMap.langwatch.output) {
    if (
      Array.isArray(attributesMap.langwatch.output) &&
      attributesMap.langwatch.output.length === 1
    ) {
      state.output = (attributesMap as any).langwatch.output[0];
    } else {
      state.output = (attributesMap as any).langwatch.output;
    }
    (attributesMap as any).langwatch.output = void 0;
  }
}

function applyLangwatchRagContexts(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (Array.isArray(attributesMap.langwatch.rag_contexts)) {
    for (const ragContext of attributesMap.langwatch.rag_contexts as any) {
      state.contexts.push(ragContext);
    }
    (attributesMap as any).langwatch.rag_contexts = void 0;
  }
}

function applyLangwatchPromptIds(state: SpanBuildState): void {
  const { attributesMap, trace } = state;
  const prompt = attributesMap.langwatch.prompt;
  if (!prompt) return;

  if (typeof prompt?.id === "string") {
    trace.reservedTraceMetadata.prompt_ids ??= [];
    trace.reservedTraceMetadata.prompt_ids.push(prompt.id);
  }
  if (prompt?.version) {
    const version = prompt.version;
    if (typeof version?.id === "string") {
      trace.reservedTraceMetadata.prompt_version_ids ??= [];
      trace.reservedTraceMetadata.prompt_version_ids.push(version.id);
    }
  }
}

// Metrics
function applyLangwatchMetrics(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!attributesMap.langwatch.metrics) return;
  try {
    state.metrics = {
      ...state.metrics,
      ...spanMetricsSchema.parse(attributesMap.langwatch.metrics as any),
    };
    delete (attributesMap as any).langwatch.metrics;
  } catch {
    // ignore
  }
}

// Params
function applyLangwatchParams(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!attributesMap.langwatch.params) return;
  try {
    state.params = {
      ...state.params,
      ...reservedSpanParamsSchema.parse(attributesMap.langwatch.params as any),
    };
    delete (attributesMap as any).langwatch.params;
  } catch {
    // ignore
  }
}

// Timestamps
function applyLangwatchTimestamps(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (!attributesMap.langwatch.timestamps) return;
  try {
    const timestamps = spanTimestampsSchema
      .partial()
      .parse(attributesMap.langwatch.timestamps as any);
    if (timestamps.started_at) {
      state.started_at = timestamps.started_at;
    }
    if (timestamps.finished_at) {
      state.finished_at = timestamps.finished_at;
    }
    if (timestamps.first_token_at) {
      state.first_token_at = timestamps.first_token_at;
    }
    delete (attributesMap as any).langwatch.timestamps;
  } catch {
    // ignore
  }
}

// langwatch
function applyLangwatchAttributes(state: SpanBuildState): void {
  const { attributesMap } = state;
  if (
    !(attributesMap.langwatch && typeof attributesMap.langwatch === "object")
  ) {
    return;
  }

  applyLangwatchSpanType(state);
  applyLangwatchReservedIds(state);
  applyLangwatchLabels(state);
  applyLangwatchInputOutput(state);
  applyLangwatchRagContexts(state);
  applyLangwatchPromptIds(state);
  applyLangwatchMetrics(state);
  applyLangwatchParams(state);
  applyLangwatchTimestamps(state);
}

// Metadata
function applyMetadataMapping(state: SpanBuildState): void {
  const { trace } = state;
  const mappedMetadata = applyMappingsToMetadata(state.metadata);
  const { reservedTraceMetadata, customMetadata } =
    extractReservedAndCustomMetadata(mappedMetadata);

  if (Object.keys(reservedTraceMetadata).length > 0) {
    trace.reservedTraceMetadata = {
      ...trace.reservedTraceMetadata,
      ...reservedTraceMetadata,
    };
  }

  if (Object.keys(customMetadata).length > 0) {
    trace.customMetadata = {
      ...trace.customMetadata,
      ...customMetadata,
    };
  }
}

function buildFinalSpanTimestamps(state: SpanBuildState): Span["timestamps"] {
  return {
    ...(state.started_at ? { started_at: state.started_at } : {}),
    ...(state.finished_at ? { finished_at: state.finished_at } : {}),
    ...(state.first_token_at ? { first_token_at: state.first_token_at } : {}),
  } as Span["timestamps"];
}

function buildFinalSpan(
  state: SpanBuildState,
): BaseSpan & { model?: LLMSpan["model"]; metrics?: LLMSpan["metrics"] } {
  const { incomingSpan, incomingScope } = state;
  state.params = {
    ...state.params,
    ...removeEmptyKeys(state.attributesMap),
    ...(incomingScope ? { scope: incomingScope } : {}),
  };

  return {
    span_id: incomingSpan.spanId as string,
    trace_id: incomingSpan.traceId as string,
    ...(incomingSpan.parentSpanId
      ? { parent_id: incomingSpan.parentSpanId as string }
      : {}),
    name: state.name,
    type: state.type,
    ...(state.model ? { model: state.model } : {}),
    input: state.input,
    output: state.output,
    ...(state.error ? { error: state.error } : {}),
    ...(state.metrics && Object.keys(state.metrics).length > 0
      ? { metrics: state.metrics }
      : {}),
    ...(state.contexts && state.contexts.length > 0
      ? { contexts: state.contexts }
      : {}),
    params: state.params,
    timestamps: buildFinalSpanTimestamps(state),
  };
}

const addOpenTelemetrySpanAsSpan = (
  trace: TraceForCollection,
  incomingSpan: DeepPartial<ISpan>,
  incomingScope: DeepPartial<IInstrumentationScope> | undefined,
): void => {
  tracer.withActiveSpan(
    "addOpenTelemetrySpanAsSpan",
    { kind: SpanKind.INTERNAL },
    (otelSpan) => {
      try {
        otelSpan.setAttributes({
          "span.id": incomingSpan.spanId as string,
          "events.count": incomingSpan.events?.length ?? 0,
        });
        if (incomingSpan.kind !== void 0) {
          otelSpan.setAttribute("span.kind", incomingSpan.kind);
        }

        const state: SpanBuildState = {
          incomingSpan,
          incomingScope,
          attributesMap: otelAttributesToNestedAttributes(
            incomingSpan.attributes,
          ),
          trace,
          type: "span",
          model: undefined,
          input: null,
          output: null,
          params: {},
          metadata: {},
          started_at: parseTimestamp(incomingSpan.startTimeUnixNano),
          finished_at: parseTimestamp(incomingSpan.endTimeUnixNano),
          first_token_at: null,
          error: null,
          metrics: {},
          contexts: [],
          name: incomingSpan.name,
        };

        computeFirstTokenAtFromEvents(state);
        applyStrandsAgentsInputOutput(state);
        applyFirstTokenAtFromAttributes(state);

        inferSpanType(state);
        applyStrandsAgentMetadataForAgentType(state);
        applyGenAiResponseModelType(state);

        inferModel(state);

        extractSpanInput(state);
        extractSpanOutput(state);

        mergeAttributesMetadata(state);

        extractMetrics(state);

        extractInvocationParams(state);
        extractReservedIdsFromAttributes(state);
        extractVercelToolParams(state);

        extractSpanError(state);

        inferSpanName(state);

        extractHaystackRagContexts(state);

        applyLangwatchAttributes(state);

        applyMetadataMapping(state);

        trace.spans.push(buildFinalSpan(state));
      } catch (error) {
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        otelSpan.recordException(toError(error));
        throw error;
      }
    },
  );
};

// prepare the container for the next path segment
function stepIntoPathContainer(
  cursor: any,
  key: string | number,
  createsArray: boolean,
): any {
  if (typeof cursor[key] !== "object" || cursor[key] === null) {
    cursor[key] = createsArray ? [] : {};
  }
  return cursor[key];
}

export function otelAttributesToNestedAttributes(
  attributes: DeepPartial<IKeyValue[]> | undefined,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const kv of attributes ?? []) {
    if (!kv?.key) continue;

    const path = kv.key.split(".");
    const last = path.pop()!;
    let cursor: any = result;

    // walk the paths, and create every segment *except* the last
    path.forEach((seg, i) => {
      const nextIsIndex = /^\d+$/.test(path[i + 1] ?? "");
      const segIsIndex = /^\d+$/.test(seg);
      const key = segIsIndex ? Number(seg) : seg;

      cursor = stepIntoPathContainer(cursor, key, nextIsIndex);
    });

    // detect leaf type and cast key to correct type
    const leafIsIndex = /^\d+$/.test(last);
    const key = leafIsIndex ? Number(last) : last;

    cursor[key] = resolveOtelAnyValue(kv.value);
  }

  return result;
}

const isNumeric = (n: any) => !isNaN(parseFloat(n)) && isFinite(n);

function resolveOtelStringValue(value: string): any {
  if (isNumeric(value)) return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapLongInt(value: any): any {
  return Long.isLong(value) ? value.toInt() : value;
}

function unwrapLongDouble(value: any): any {
  return Long.isLong(value) ? value.toNumber() : value;
}

function resolveOtelAnyValue(anyValuePair?: DeepPartial<IAnyValue>): any {
  if (!anyValuePair) return void 0;

  if (anyValuePair.stringValue != null)
    return resolveOtelStringValue(anyValuePair.stringValue);

  if (anyValuePair.boolValue != null) return anyValuePair.boolValue;
  if (anyValuePair.intValue != null)
    return unwrapLongInt(anyValuePair.intValue);
  if (anyValuePair.doubleValue != null)
    return unwrapLongDouble(anyValuePair.doubleValue);
  if (anyValuePair.bytesValue != null) return anyValuePair.bytesValue;

  if (anyValuePair.kvlistValue)
    return otelAttributesToNestedAttributes(anyValuePair.kvlistValue.values);

  if (anyValuePair.arrayValue?.values)
    return anyValuePair.arrayValue.values.map(resolveOtelAnyValue);

  return void 0;
}

const maybeConvertLongBits = (value: any): number => {
  if (value && typeof value === "object" && "high" in value && "low" in value) {
    const { high, low, unsigned } = value;

    // Create a BigInt from the high and low bits
    const result = (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);

    // If it's an unsigned long, return it as is
    if (unsigned) {
      return Number(result);
    }

    // For signed longs, we need to handle the two's complement representation
    const signBit = 1n << 63n;
    if (result & signBit) {
      // If the sign bit is set, it's a negative number
      return Number(-(~result & ((1n << 64n) - 1n)) - 1n);
    } else {
      // If the sign bit is not set, it's a positive number
      return Number(result);
    }
  }
  return value;
};

const isEmptyObjectValue = (value: any): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

const isEmptyArrayValue = (value: any): boolean =>
  Array.isArray(value) && value.length === 0;

const isEmptyValue = (value: any): boolean =>
  value === null ||
  value === undefined ||
  isEmptyObjectValue(value) ||
  isEmptyArrayValue(value);

function cleanRemoveEmptyKeysEntry(
  key: string,
  value: any,
  result: Record<string, any>,
): void {
  if (typeof value === "object" && value !== null) {
    const cleanedValue = removeEmptyKeys(value as Record<string, any>);
    if (!isEmptyValue(cleanedValue)) {
      result[key] = cleanedValue;
    }
  } else if (!isEmptyValue(value)) {
    result[key] = value;
  }
}

const removeEmptyKeys = (obj: Record<string, any>): Record<string, any> => {
  if (!obj) return obj;

  if (typeof obj === "string") return obj;

  if (Array.isArray(obj)) {
    return obj.map(removeEmptyKeys).filter((v) => !isEmptyValue(v));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    cleanRemoveEmptyKeysEntry(key, value, result);
  }

  return Object.keys(result).length > 0 ? result : {};
};

const applyMappingsToMetadata = (metadata: any) => {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      const langWatchKey = openTelemetryToLangWatchMetadataMapping[key];
      if (!langWatchKey) {
        return [key, value];
      }

      return [langWatchKey, value];
    }),
  );
};

const extractReservedAndCustomMetadata = (metadata: any) => {
  if ("threadId" in metadata) {
    metadata.thread_id = metadata.threadId;
    delete metadata.threadId;
  }
  if ("userId" in metadata) {
    metadata.user_id = metadata.userId;
    delete metadata.userId;
  }
  if ("customerId" in metadata) {
    metadata.customer_id = metadata.customerId;
    delete metadata.customerId;
  }
  const reservedTraceMetadata = Object.fromEntries(
    Object.entries(reservedTraceMetadataSchema.parse(metadata)).filter(
      ([_key, value]) => value !== null && value !== undefined,
    ),
  );
  const remainingMetadata = Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !(key in reservedTraceMetadataSchema.shape),
    ),
  );
  const customMetadata = customMetadataSchema.parse(remainingMetadata);

  return {
    reservedTraceMetadata,
    customMetadata,
  };
};
