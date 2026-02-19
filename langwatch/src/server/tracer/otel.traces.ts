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
import { createLogger } from "~/utils/logger/server";
import type { DeepPartial } from "../../utils/types";
import type { CollectorJob } from "../background/types";
import { openTelemetryToLangWatchMetadataMapping } from "./metadata";
import {
  extractStrandsAgentsInputOutput,
  extractStrandsAgentsMetadata,
  isStrandsAgentsInstrumentation,
} from "./span-event-processing/strands-agents";
import type {
  BaseSpan,
  ChatMessage,
  LLMSpan,
  RAGChunk,
  Span,
  SpanTypes,
  TypedValueChatMessages,
} from "./types";
import {
  chatMessageSchema,
  customMetadataSchema,
  rESTEvaluationSchema,
  reservedSpanParamsSchema,
  reservedTraceMetadataSchema,
  spanMetricsSchema,
  spanTimestampsSchema,
  spanTypesSchema,
  typedValueChatMessagesSchema,
} from "./types.generated";
import { decodeBase64OpenTelemetryId, decodeOpenTelemetryId } from "./utils";

const logger = createLogger("langwatch.tracer.otel.traces");
const tracer = getLangWatchTracer("langwatch.tracer.otel.traces");

export type TraceForCollection = Pick<
  CollectorJob,
  | "traceId"
  | "spans"
  | "reservedTraceMetadata"
  | "customMetadata"
  | "evaluations"
>;

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
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    },
  );
};

const decodeOpenTelemetryIds = (
  otelTrace: DeepPartial<IExportTraceServiceRequest>,
) => {
  try {
    for (const resourceSpan of otelTrace.resourceSpans ?? []) {
      for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
        for (const span of scopeSpan?.spans ?? []) {
          if (span?.traceId) {
            const decoded =
              typeof span.traceId === "string"
                ? decodeBase64OpenTelemetryId(span.traceId)
                : decodeOpenTelemetryId(span.traceId);
            if (decoded) {
              span.traceId = decoded;
            }
          }
          if (span?.spanId) {
            const decoded =
              typeof span.spanId === "string"
                ? decodeBase64OpenTelemetryId(span.spanId)
                : decodeOpenTelemetryId(span.spanId);
            if (decoded) {
              span.spanId = decoded;
            }
          }
          if (span?.parentSpanId) {
            const decoded =
              typeof span.parentSpanId === "string"
                ? decodeBase64OpenTelemetryId(span.parentSpanId)
                : decodeOpenTelemetryId(span.parentSpanId);
            if (decoded) {
              span.parentSpanId = decoded;
            }
          }
        }
      }
    }

    return;
  } catch (error) {
    throw error;
  }
};

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

        const customMetadata: Record<string, any> = {};
        for (const resourceSpan of otelTrace.resourceSpans ?? []) {
          for (const attribute of resourceSpan?.resource?.attributes ?? []) {
            if (attribute?.key) {
              customMetadata[attribute.key] = attribute?.value?.stringValue;
            }
          }
        }

        const trace: TraceForCollection = {
          traceId,
          spans: [],
          evaluations: [],
          reservedTraceMetadata: {},
          customMetadata,
        };

        for (const resourceSpan of otelTrace.resourceSpans ?? []) {
          for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
            for (const span of scopeSpan?.spans ?? []) {
              if (span?.traceId === traceId) {
                addOpenTelemetrySpanAsSpan(trace, span, scopeSpan?.scope);
              }
            }
          }
        }

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
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
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

        let type: Span["type"] = "span";
        let model: LLMSpan["model"] = undefined;
        let input: LLMSpan["input"] = null;
        let output: LLMSpan["output"] = null;
        let params: Span["params"] = {};
        let metadata: Record<string, unknown> = {};
        let started_at: Span["timestamps"]["started_at"] | undefined =
          parseTimestamp(incomingSpan.startTimeUnixNano);
        let finished_at: Span["timestamps"]["finished_at"] | undefined =
          parseTimestamp(incomingSpan.endTimeUnixNano);
        let error: Span["error"] = null;
        const attributesMap = otelAttributesToNestedAttributes(
          incomingSpan.attributes,
        );

        // First token at
        let first_token_at: Span["timestamps"]["first_token_at"] = null;
        for (const event of incomingSpan?.events ?? []) {
          if (!event) continue;

          switch (event.name) {
            case "First Token Stream Event":
            case "llm.content.completion.chunk": {
              const ts = parseTimestamp(event?.timeUnixNano);
              if (ts && (!first_token_at || ts < first_token_at)) {
                first_token_at = ts;
              }
              break;
            }
            case "langwatch.evaluation.custom": {
              const jsonPayload = event.attributes?.find(
                (attr) => attr?.key === "json_encoded_event",
              )?.value?.stringValue;
              if (!jsonPayload) {
                logger.warn(
                  { event },
                  "event for `langwatch.evaluation.custom` has no json_encoded_event",
                );
                break;
              }

              try {
                const parsedJsonPayload = JSON.parse(jsonPayload);
                const evaluation =
                  rESTEvaluationSchema.parse(parsedJsonPayload);

                if (!trace.evaluations) trace.evaluations = [];
                trace.evaluations.push(evaluation);
              } catch (error) {
                logger.error(
                  { error, jsonPayload },
                  "error parsing json_encoded_event from `langwatch.evaluation.custom`, event discarded",
                );
              }
              break;
            }

            default:
              break;
          }
        }

        // Special handling for strands-agents Python SDK
        if (isStrandsAgentsInstrumentation(incomingScope, incomingSpan)) {
          const io = extractStrandsAgentsInputOutput(incomingSpan);
          if (io) {
            input = io.input;
            output = io.output;
          }
        }

        if (started_at && attributesMap.gen_ai?.server?.time_to_first_token) {
          first_token_at =
            started_at +
            parseInt(
              (attributesMap as any).gen_ai.server.time_to_first_token,
              10,
            );
        }

        if (started_at && attributesMap.ai?.response?.msToFirstChunk) {
          first_token_at =
            started_at +
            parseInt((attributesMap as any).ai.response.msToFirstChunk, 10);
        }

        // Type
        if (
          (incomingSpan.kind as any) === "SPAN_KIND_SERVER" ||
          incomingSpan.kind === ESpanKind.SPAN_KIND_SERVER
        ) {
          type = "server";
        }
        if (
          (incomingSpan.kind as any) === "SPAN_KIND_CLIENT" ||
          incomingSpan.kind === ESpanKind.SPAN_KIND_CLIENT
        ) {
          type = "client";
        }
        if (
          (incomingSpan.kind as any) === "SPAN_KIND_PRODUCER" ||
          incomingSpan.kind === ESpanKind.SPAN_KIND_PRODUCER
        ) {
          type = "producer";
        }
        if (
          (incomingSpan.kind as any) === "SPAN_KIND_CONSUMER" ||
          incomingSpan.kind === ESpanKind.SPAN_KIND_CONSUMER
        ) {
          type = "consumer";
        }

        if (attributesMap.openinference?.span?.kind) {
          const kind_ = (
            attributesMap as any
          ).openinference.span.kind.toLowerCase();
          if (allowedSpanTypes.includes(kind_ as SpanTypes)) {
            type = kind_ as SpanTypes;
            delete (attributesMap as any).openinference.span.kind;
          }
        }

        if (attributesMap.traceloop?.span?.kind) {
          const kind_ = (
            attributesMap as any
          ).traceloop.span.kind.toLowerCase();
          if (allowedSpanTypes.includes(kind_ as SpanTypes)) {
            type = kind_ as SpanTypes;
            delete (attributesMap as any).traceloop.span.kind;
          }
        }

        if (attributesMap?.type) {
          type = attributesMap.type as SpanTypes;
          attributesMap.type = void 0;
        }

        if (
          attributesMap.llm?.request?.type === "chat" ||
          attributesMap.llm?.request?.type === "completion"
        ) {
          type = "llm";
          delete attributesMap.llm.request.type;
        }
        // vercel
        if (attributesMap.ai && attributesMap.gen_ai) {
          type = "llm";
        }
        if (attributesMap.operation?.name === "ai.toolCall") {
          type = "tool";
        }
        // Agents
        if (attributesMap.gen_ai?.agent || attributesMap.agent?.name) {
          // Strands agent
          if (incomingSpan.name === "Model invoke") {
            type = "llm";
          } else {
            type = "agent";
          }
        }

        // GenAI semantic convention chat LLM calls (Strands, OpenClaw, etc.)
        // CLIENT span kind is standard for gen_ai LLM calls per the OTEL GenAI spec
        if (
          (type === "span" || type === "client") &&
          attributesMap.gen_ai?.operation?.name === "chat"
        ) {
          type = "llm";
        }
        if (
          (type === "span" || type === "client") &&
          attributesMap.gen_ai?.operation?.name === "tool"
        ) {
          type = "tool";
        }

        // Extract metadata for agent spans from strands-agents
        if (
          type === "agent" &&
          isStrandsAgentsInstrumentation(incomingScope, incomingSpan)
        ) {
          const strandsMetadata = extractStrandsAgentsMetadata(incomingSpan);
          if (Object.keys(strandsMetadata).length > 0) {
            metadata = {
              ...metadata,
              ...strandsMetadata,
            };
          }
        }

        // infer for others otel gen_ai spec
        if (
          (type === "span" || type === "client") &&
          attributesMap.gen_ai?.response?.model
        ) {
          type = "llm";
        }

        // Model
        if (attributesMap.llm?.model_name) {
          model = (attributesMap as any).llm.model_name;
          attributesMap.llm.model_name = void 0;
        }

        if (attributesMap.gen_ai?.request?.model) {
          model = (attributesMap as any).gen_ai.request.model;
          attributesMap.gen_ai.request.model = void 0;
        }

        if (attributesMap.gen_ai?.response?.model) {
          model = (attributesMap as any).gen_ai.response.model;
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
          model = [provider, (attributesMap as any).ai.model.id]
            .filter(Boolean)
            .join("/");
          delete attributesMap.ai.model;
        }

        // Input

        // GenAI semantic convention: gen_ai.input.messages (e.g. OpenClaw, OTEL GenAI spec)
        // We assign directly as chat_messages without Zod validation to avoid
        // stripping content fields that use provider-specific formats (e.g.
        // Anthropic tool_use/tool_result content blocks).
        if (
          !input &&
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
          messages.push(
            ...(attributesMap.gen_ai.input.messages as ChatMessage[]),
          );
          input = { type: "chat_messages", value: messages };
          delete (attributesMap as any).gen_ai.input.messages;
        }

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
            input = input_.data as TypedValueChatMessages;
            delete attributesMap.llm.input_messages;
          }
        }

        if (
          !input &&
          attributesMap.gen_ai?.prompt &&
          Array.isArray(attributesMap.gen_ai.prompt)
        ) {
          const input_ = typedValueChatMessagesSchema.safeParse({
            type: "chat_messages",
            value: attributesMap.gen_ai.prompt,
          });

          if (input_.success) {
            input = input_.data as TypedValueChatMessages;
          } else {
            input = {
              type: "json",
              value: attributesMap.gen_ai.prompt,
            };
          }
          delete attributesMap.gen_ai.prompt;
        }

        if (!input && typeof attributesMap.gen_ai?.prompt === "string") {
          try {
            const parsed = JSON.parse(attributesMap.gen_ai.prompt);
            input = {
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

            output = {
              type: "text",
              value: attributesMap.gen_ai.prompt,
            };
          }
          delete attributesMap.gen_ai.prompt;
        }
        if (
          !input &&
          attributesMap.gen_ai?.prompt?.messages &&
          Array.isArray(attributesMap.gen_ai.prompt.messages)
        ) {
          const input_ = typedValueChatMessagesSchema.safeParse({
            type: "chat_messages",
            value: attributesMap.gen_ai.prompt.messages,
          });

          if (input_.success) {
            input = input_.data as TypedValueChatMessages;
            delete attributesMap.gen_ai.prompt;
          } else {
            input = {
              type: "json",
              value: attributesMap.gen_ai.prompt.messages,
            };
          }
        }

        // vercel
        if (
          !input &&
          attributesMap.ai?.prompt?.messages &&
          Array.isArray(attributesMap.ai.prompt.messages)
        ) {
          const input_ = typedValueChatMessagesSchema.safeParse({
            type: "chat_messages",
            value: attributesMap.ai.prompt.messages,
          });

          if (input_.success) {
            input = input_.data as TypedValueChatMessages;
            delete attributesMap.ai.prompt;
          }
        }
        if (!input && type === "tool" && attributesMap.ai?.toolCall?.args) {
          input = {
            type: "json",
            value: attributesMap.ai?.toolCall?.args,
          };
        }

        if (!input && attributesMap.traceloop?.entity?.input) {
          input =
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
            input.type === "json" &&
            typeof json === "object" &&
            json !== null &&
            "metadata" in json &&
            // @ts-ignore
            typeof json.metadata === "object" &&
            // @ts-ignore
            !Array.isArray(json.metadata)
          ) {
            metadata = {
              ...metadata,
              ...json.metadata,
            };

            json.metadata = void 0;
          }

          attributesMap.traceloop.entity.input = void 0;
        }

        // Check for vercel metadata
        if (
          attributesMap.ai?.telemetry?.metadata &&
          typeof attributesMap.ai.telemetry.metadata === "object"
        ) {
          metadata = {
            ...metadata,
            ...attributesMap.ai.telemetry.metadata,
          };

          attributesMap.ai.telemetry.metadata = void 0;
        }

        if (!input && attributesMap.input?.value) {
          input =
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

        if (!input && attributesMap.crew_inputs) {
          input = {
            type: "json",
            value: attributesMap.crew_inputs,
          };
        }

        // logfire
        if (!input && attributesMap.raw_input) {
          input = {
            type: "chat_messages",
            value: attributesMap.raw_input as any,
          };
        }

        // Output

        // GenAI semantic convention: gen_ai.output.messages (e.g. OpenClaw, OTEL GenAI spec)
        // Assign directly without Zod validation to preserve all content fields.
        if (
          !output &&
          attributesMap.gen_ai?.output?.messages &&
          Array.isArray(attributesMap.gen_ai.output.messages)
        ) {
          output = {
            type: "chat_messages",
            value: attributesMap.gen_ai.output.messages as ChatMessage[],
          };
          delete (attributesMap as any).gen_ai.output.messages;
        }

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
            output = output_.data as TypedValueChatMessages;
            delete attributesMap.llm.output_messages;
          }
        }

        if (
          !output &&
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
            output = output_.data as TypedValueChatMessages;
          } else {
            output = {
              type: "json",
              value: attributesMap.gen_ai.completion,
            };
          }
          delete attributesMap.gen_ai.completion;
        }

        if (
          !output &&
          attributesMap.gen_ai?.completion &&
          !Array.isArray(attributesMap.gen_ai.completion)
        ) {
          output = {
            type: "json",
            value: attributesMap.gen_ai.completion,
          };
          delete attributesMap.gen_ai.completion;
        }

        if (!output && typeof attributesMap.gen_ai?.completion === "string") {
          try {
            const parsed = JSON.parse(attributesMap.gen_ai.completion);
            output = {
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

            output = {
              type: "text",
              value: attributesMap.gen_ai.completion,
            };
          }
          delete attributesMap.gen_ai.completion;
        }

        // vercel
        if (!output && attributesMap.ai?.response) {
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
            output = {
              type: "chat_messages",
              value: messages_,
            };
          }
        }
        if (!output && attributesMap.ai?.response?.object) {
          output = {
            type: "json",
            value: (attributesMap as any).ai.response.object,
          };
          delete (attributesMap as any).ai.response.object;
        }

        if (!output && attributesMap.llm?.output_messages) {
          output =
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

        if (!output && attributesMap.traceloop?.entity?.output) {
          output =
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

        if (!output && attributesMap.output?.value) {
          output =
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

        // logfire
        if (!output) {
          if (Array.isArray(attributesMap?.events)) {
            // event && typeof event === "object" -> this is needed as `null` is typeof object!
            const event = attributesMap.events.find(
              (event) =>
                event &&
                typeof event === "object" &&
                event["event.name"] === "gen_ai.choice",
            );
            if (event?.message) {
              output = {
                type: "chat_messages",
                value: [event.message],
              };
            }
          }
        }

        if (
          attributesMap.metadata &&
          typeof attributesMap.metadata === "object" &&
          !Array.isArray(attributesMap.metadata)
        ) {
          metadata = {
            ...metadata,
            ...(attributesMap as any).metadata,
          };

          attributesMap.metadata = void 0;
        }

        // Metrics
        let metrics: LLMSpan["metrics"] = {};
        if (attributesMap.ai?.usage) {
          if (typeof attributesMap.ai.usage.promptTokens === "number") {
            metrics.prompt_tokens = attributesMap.ai.usage.promptTokens;
            delete attributesMap.ai.usage.promptTokens;
          }
          if (typeof attributesMap.ai.usage.completionTokens === "number") {
            metrics.completion_tokens = attributesMap.ai.usage.completionTokens;
            delete attributesMap.ai.usage.completionTokens;
          }
        }
        if (attributesMap.gen_ai?.usage) {
          if (typeof attributesMap.gen_ai.usage.prompt_tokens === "number") {
            metrics.prompt_tokens = attributesMap.gen_ai.usage.prompt_tokens;
          }
          if (
            typeof attributesMap.gen_ai.usage.completion_tokens === "number"
          ) {
            metrics.completion_tokens =
              attributesMap.gen_ai.usage.completion_tokens;
          }
          // Spring AI
          if (
            attributesMap.gen_ai.usage.input_tokens &&
            !isNaN(Number(attributesMap.gen_ai.usage.input_tokens))
          ) {
            metrics.prompt_tokens = Number(
              attributesMap.gen_ai.usage.input_tokens,
            );
          }
          if (
            attributesMap.gen_ai.usage.output_tokens &&
            !isNaN(Number(attributesMap.gen_ai.usage.output_tokens))
          ) {
            metrics.completion_tokens = Number(
              attributesMap.gen_ai.usage.output_tokens,
            );
          }
          // Reasoning tokens (Traceloop/OpenLLMetry convention: gen_ai.usage.reasoning_tokens)
          if (
            attributesMap.gen_ai.usage.reasoning_tokens != null &&
            !isNaN(Number(attributesMap.gen_ai.usage.reasoning_tokens))
          ) {
            metrics.reasoning_tokens = Number(
              attributesMap.gen_ai.usage.reasoning_tokens,
            );
          }
          // Cache tokens (OTEL semconv: gen_ai.usage.cache_read.input_tokens / gen_ai.usage.cache_creation.input_tokens)
          if (
            attributesMap.gen_ai.usage.cache_read?.input_tokens != null &&
            !isNaN(Number(attributesMap.gen_ai.usage.cache_read.input_tokens))
          ) {
            metrics.cache_read_input_tokens = Number(
              attributesMap.gen_ai.usage.cache_read.input_tokens,
            );
          }
          if (
            attributesMap.gen_ai.usage.cache_creation?.input_tokens != null &&
            !isNaN(
              Number(attributesMap.gen_ai.usage.cache_creation.input_tokens),
            )
          ) {
            metrics.cache_creation_input_tokens = Number(
              attributesMap.gen_ai.usage.cache_creation.input_tokens,
            );
          }
        }

        // Params
        if (attributesMap.llm?.invocation_parameters) {
          params = {
            ...params,
            ...(attributesMap.llm.invocation_parameters as Record<string, any>),
          };
          delete attributesMap.llm.invocation_parameters;
        }

        if (attributesMap.llm?.is_streaming) {
          params = {
            ...params,
            stream:
              attributesMap.llm.is_streaming &&
              attributesMap.llm.is_streaming !== "false" &&
              attributesMap.llm.is_streaming !== "False",
          };
          delete attributesMap.llm.is_streaming;
        }

        if (
          attributesMap.user?.id &&
          typeof attributesMap.user.id === "string"
        ) {
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

        // vercel
        if (attributesMap.ai?.prompt?.tools) {
          params = {
            ...params,
            tools: attributesMap.ai.prompt.tools as any,
          };
          delete attributesMap.ai.prompt.tools;
        }

        if (attributesMap.ai?.prompt?.toolsChoice) {
          params = {
            ...params,
            tool_choice: attributesMap.ai.prompt.toolsChoice as any,
          };
          delete attributesMap.ai.prompt.toolsChoice;
        }

        // Exception
        if (
          (incomingSpan.status?.code as any) === "STATUS_CODE_ERROR" ||
          (incomingSpan.status?.code as any) === 2 // EStatusCode.STATUS_CODE_ERROR
        ) {
          error = {
            has_error: true,
            message: incomingSpan.status?.message ?? "Exception",
            stacktrace: [],
          };
        }

        for (const event of incomingSpan?.events ?? []) {
          if (event?.name === "exception") {
            const eventAttributes = otelAttributesToNestedAttributes(
              event?.attributes,
            );

            let errorMessage: string;
            if (
              eventAttributes.exception?.message &&
              eventAttributes.exception?.type
            ) {
              errorMessage = `${eventAttributes.exception.type}: ${eventAttributes.exception.message}`;
            } else if (incomingSpan.status?.message) {
              errorMessage = incomingSpan.status.message;
            } else {
              errorMessage = "Unknown Exception Occurred";
            }

            error = {
              has_error: true,
              message: errorMessage,
              stacktrace: eventAttributes.exception?.stacktrace
                ? (eventAttributes.exception?.stacktrace as string).split("\n")
                : [],
            };
          }
        }

        // Name
        let name = incomingSpan.name;
        if (name === "Task._execute_core" && (input?.value as any)?.agent) {
          try {
            name =
              (input?.value as any).agent.match(/role='(.*?)'/)?.[1] ?? name;
          } catch {
            /* this is just a safe json parse fallback */
          }
        }

        // vercel
        if (!name && type === "llm" && attributesMap.gen_ai && model) {
          name = model;
        }
        if (type === "tool" && attributesMap.ai?.toolCall?.name) {
          name = (attributesMap as any).ai.toolCall.name;
        }
        // Agent
        if (!name && attributesMap.gen_ai?.agent?.name) {
          name = (attributesMap as any).gen_ai.agent.name;
        }

        const contexts: RAGChunk[] = [];
        // haystack RAG
        if (Array.isArray((attributesMap.retrieval as any)?.documents)) {
          type = "rag";
          for (const document of (attributesMap.retrieval as any).documents) {
            const document_ = document.document;
            if (document_?.content) {
              contexts.push({
                ...(document_.id ? { document_id: document_.id } : {}),
                content: document_.content,
              });
            }
          }
        }

        // langwatch
        if (
          attributesMap.langwatch &&
          typeof attributesMap.langwatch === "object"
        ) {
          if (attributesMap.langwatch.span?.type) {
            type = (attributesMap as any).langwatch.span.type;
            (attributesMap as any).langwatch.span.type = void 0;
          }

          if (typeof attributesMap.langwatch.thread?.id === "string") {
            trace.reservedTraceMetadata.thread_id =
              attributesMap.langwatch.thread.id;
            (attributesMap as any).langwatch.thread.id = void 0;
          }
          if (typeof attributesMap.langwatch.user?.id === "string") {
            trace.reservedTraceMetadata.user_id =
              attributesMap.langwatch.user.id;
            (attributesMap as any).langwatch.user.id = void 0;
          }
          if (typeof attributesMap.langwatch.customer?.id === "string") {
            trace.reservedTraceMetadata.customer_id =
              attributesMap.langwatch.customer.id;
            (attributesMap as any).langwatch.customer.id = void 0;
          }
          if (Array.isArray(attributesMap.langwatch.labels)) {
            metadata = {
              ...metadata,
              labels: attributesMap.langwatch.labels,
            };
            (attributesMap as any).langwatch.labels = void 0;
          }
          // Backward compatibility for legacy "langwatch.tags" attribute
          if (
            !metadata.labels &&
            Array.isArray((attributesMap as any).langwatch.tags)
          ) {
            metadata = {
              ...metadata,
              labels: (attributesMap as any).langwatch.tags,
            };
            (attributesMap as any).langwatch.tags = void 0;
          }

          if (attributesMap.langwatch.input) {
            if (
              Array.isArray(attributesMap.langwatch.input) &&
              attributesMap.langwatch.input.length === 1
            ) {
              input = (attributesMap as any).langwatch.input[0];
            } else {
              input = (attributesMap as any).langwatch.input;
            }
            (attributesMap as any).langwatch.input = void 0;
          }
          if (attributesMap.langwatch.output) {
            if (
              Array.isArray(attributesMap.langwatch.output) &&
              attributesMap.langwatch.output.length === 1
            ) {
              output = (attributesMap as any).langwatch.output[0];
            } else {
              output = (attributesMap as any).langwatch.output;
            }
            (attributesMap as any).langwatch.output = void 0;
          }
          if (Array.isArray(attributesMap.langwatch.rag_contexts)) {
            for (const ragContext of attributesMap.langwatch
              .rag_contexts as any) {
              contexts.push(ragContext);
            }
            (attributesMap as any).langwatch.rag_contexts = void 0;
          }
          const prompt = attributesMap.langwatch.prompt;
          if (prompt) {
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
          if (attributesMap.langwatch.metrics) {
            try {
              metrics = {
                ...metrics,
                ...spanMetricsSchema.parse(
                  attributesMap.langwatch.metrics as any,
                ),
              };
              delete (attributesMap as any).langwatch.metrics;
            } catch {
              // ignore
            }
          }
          // Params
          if (attributesMap.langwatch.params) {
            try {
              params = {
                ...params,
                ...reservedSpanParamsSchema.parse(
                  attributesMap.langwatch.params as any,
                ),
              };
              delete (attributesMap as any).langwatch.params;
            } catch {
              // ignore
            }
          }
          // Timestamps
          if (attributesMap.langwatch.timestamps) {
            try {
              const timestamps = spanTimestampsSchema
                .partial()
                .parse(attributesMap.langwatch.timestamps as any);
              if (timestamps.started_at) {
                started_at = timestamps.started_at;
              }
              if (timestamps.finished_at) {
                finished_at = timestamps.finished_at;
              }
              if (timestamps.first_token_at) {
                first_token_at = timestamps.first_token_at;
              }
              delete (attributesMap as any).langwatch.timestamps;
            } catch {
              // ignore
            }
          }
        }

        // Metadata
        const mappedMetadata = applyMappingsToMetadata(metadata);
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

        params = {
          ...params,
          ...removeEmptyKeys(attributesMap),
          ...(incomingScope ? { scope: incomingScope } : {}),
        };

        const span: BaseSpan & {
          model?: LLMSpan["model"];
          metrics?: LLMSpan["metrics"];
        } = {
          span_id: incomingSpan.spanId as string,
          trace_id: incomingSpan.traceId as string,
          ...(incomingSpan.parentSpanId
            ? { parent_id: incomingSpan.parentSpanId as string }
            : {}),
          name,
          type,
          ...(model ? { model } : {}),
          input,
          output,
          ...(error ? { error } : {}),
          ...(metrics && Object.keys(metrics).length > 0 ? { metrics } : {}),
          ...(contexts && contexts.length > 0 ? { contexts } : {}),
          params,
          timestamps: {
            ...(started_at ? { started_at } : {}),
            ...(finished_at ? { finished_at } : {}),
            ...(first_token_at ? { first_token_at } : {}),
          } as Span["timestamps"],
        };

        trace.spans.push(span);
      } catch (error) {
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        otelSpan.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    },
  );
};

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

      // prepare the container for the next segment
      if (typeof cursor[key] !== "object" || cursor[key] === null) {
        cursor[key] = nextIsIndex ? [] : {};
      }
      cursor = cursor[key];
    });

    // detect leaf type and cast key to correct type
    const leafIsIndex = /^\d+$/.test(last);
    const key = leafIsIndex ? Number(last) : last;

    cursor[key] = resolveOtelAnyValue(kv.value);
  }

  return result;
}

const isNumeric = (n: any) => !isNaN(parseFloat(n)) && isFinite(n);

function resolveOtelAnyValue(anyValuePair?: DeepPartial<IAnyValue>): any {
  if (!anyValuePair) return void 0;

  if (anyValuePair.stringValue != null) {
    if (isNumeric(anyValuePair.stringValue)) return anyValuePair.stringValue;

    try {
      return JSON.parse(anyValuePair.stringValue);
    } catch {
      return anyValuePair.stringValue;
    }
  }

  if (anyValuePair.boolValue != null) return anyValuePair.boolValue;
  if (anyValuePair.intValue != null)
    return Long.isLong(anyValuePair.intValue)
      ? anyValuePair.intValue.toInt()
      : anyValuePair.intValue;
  if (anyValuePair.doubleValue != null)
    return Long.isLong(anyValuePair.doubleValue)
      ? anyValuePair.doubleValue.toNumber()
      : anyValuePair.doubleValue;
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

const removeEmptyKeys = (obj: Record<string, any>): Record<string, any> => {
  const isEmptyObject = (value: any): boolean =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;

  const isEmptyArray = (value: any): boolean =>
    Array.isArray(value) && value.length === 0;

  const isEmpty = (value: any): boolean =>
    value === null ||
    value === undefined ||
    isEmptyObject(value) ||
    isEmptyArray(value);

  if (!obj) return obj;

  if (typeof obj === "string") return obj;

  if (Array.isArray(obj)) {
    return obj.map(removeEmptyKeys).filter((v) => !isEmpty(v));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      const cleanedValue = removeEmptyKeys(value as Record<string, any>);
      if (!isEmpty(cleanedValue)) {
        result[key] = cleanedValue;
      }
    } else if (!isEmpty(value)) {
      result[key] = value;
    }
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
