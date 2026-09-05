/**
 * Reading a legacy span's input, output, error and RAG contexts out of canonical attributes. Pure:
 * one place that knows how each legacy field was spelled, so the mapper and its tests agree, and
 * so the value-envelope unwrapping is stated once.
 */

import type { NormalizedAttributes, NormalizedSpan } from "@langwatch/trace-contract";
import { NormalizedStatusCode } from "@langwatch/trace-contract";
import type {
  ChatMessage,
  ErrorCapture,
  RAGChunk,
  SpanInputOutput,
} from "@langwatch/trace-contract";

type JsonSerializable = string | number | boolean | null | Record<string, unknown> | unknown[];

/**
 * Converts attribute values to JSON-serializable format.
 * Handles bigint conversion to number.
 */
function toJsonSerializable(value: unknown): JsonSerializable {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSerializable);
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = toJsonSerializable(v);
    }

    return result;
  }

  return value as JsonSerializable;
}

const KNOWN_WRAPPER_TYPES = new Set([
  "text",
  "chat_messages",
  "json",
  "raw",
  "list",
  "evaluation_result",
  "guardrail_result",
]);

/**
 * Detects the legacy {type, value} wrapper format from the REST collector
 * or preserved by canonicalization for chat_messages.
 * After ClickHouse deserialization, these appear as objects with `type` and `value`.
 */
function isLegacyWrapper(v: unknown): v is { type: string; value: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "type" in v &&
    "value" in v &&
    typeof (v as Record<string, unknown>).type === "string" &&
    KNOWN_WRAPPER_TYPES.has((v as Record<string, unknown>).type as string)
  );
}

/**
 * Unwraps a {type, value} wrapper into a proper SpanInputOutput.
 */
function unwrapLegacyWrapper(
  wrapper: { type: string; value: unknown },
  _spanAttributes: NormalizedAttributes,
  _attrKey: string,
): SpanInputOutput {
  const { type, value } = wrapper;
  if (type === "chat_messages" && Array.isArray(value)) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(value) as ChatMessage[],
    };
  }

  if (type === "text") {
    return {
      type: "text",
      value: typeof value === "string" ? value : JSON.stringify(value),
    };
  }

  if (type === "evaluation_result" || type === "guardrail_result") {
    return {
      type,
      value: toJsonSerializable(value),
    } as unknown as SpanInputOutput;
  }

  return { type: "json", value: toJsonSerializable(value) };
}

/**
 * Reads the annotated value type for a canonical key from
 * langwatch.reserved.value_types (e.g. ["langwatch.input=chat_messages"]).
 */
function getAnnotatedType(spanAttributes: NormalizedAttributes, attrKey: string): string | null {
  let raw = spanAttributes["langwatch.reserved.value_types"];

  // ClickHouse Map(String, String) stores arrays as JSON strings
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const prefix = `${attrKey}=`;
  for (const entry of raw) {
    if (typeof entry === "string" && entry.startsWith(prefix)) {
      return entry.slice(prefix.length);
    }
  }

  return null;
}

/**
 * Extracts input from canonical span attributes only. After canonicalization, input is at: 1. gen_ai.input.messages (chat messages) 2. langwatch.input
 * (text/json/structured) 3. gen_ai.tool.call.arguments (tool spans from semconv-native emitters — e.g. Copilot CLI — whose ingest path never lifted them into
 * langwatch.input)
 */
export function extractInput(spanAttributes: NormalizedAttributes): SpanInputOutput | null {
  // Priority 1: gen_ai.input.messages → always chat_messages
  const genAiInputMessages = spanAttributes["gen_ai.input.messages"];
  if (genAiInputMessages !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiInputMessages) as ChatMessage[],
    };
  }

  // Priority 2: langwatch.input → use annotated type or infer
  let lwInput = spanAttributes["langwatch.input"];
  if (lwInput !== undefined) {
    // ClickHouse Map(String, String) stores objects as JSON strings
    if (typeof lwInput === "string") {
      try {
        const parsed = JSON.parse(lwInput);
        if (typeof parsed === "object" && parsed !== null) {
          lwInput = parsed;
        }
      } catch {
        // Not JSON — keep as string
      }
    }

    // Unwrap {type, value} wrapper preserved by canonicalization (e.g. chat_messages)
    if (isLegacyWrapper(lwInput)) {
      return unwrapLegacyWrapper(lwInput, spanAttributes, "langwatch.input");
    }

    const annotatedType = getAnnotatedType(spanAttributes, "langwatch.input");
    if (annotatedType === "chat_messages" && Array.isArray(lwInput)) {
      return {
        type: "chat_messages",
        value: toJsonSerializable(lwInput) as ChatMessage[],
      };
    }

    if (annotatedType === "text" || typeof lwInput === "string") {
      // ClickHouse deserializeAttributes() may parse JSON-like strings back to
      // objects/arrays (e.g. "[{\"role\":...}]" → Array). Re-stringify to avoid
      // String([object Object]).
      const textValue = typeof lwInput === "string" ? lwInput : JSON.stringify(lwInput);

      return { type: "text", value: textValue };
    }

    return {
      type: "json",
      value: toJsonSerializable(lwInput),
    };
  }

  // Priority 3: gen_ai.tool.call.arguments — the tool-call semconv twin of
  // the messages keys above.
  const toolArguments = spanAttributes["gen_ai.tool.call.arguments"];
  if (toolArguments !== undefined) {
    return parseJsonOrText(toolArguments);
  }

  return null;
}

/**
 * A raw semconv payload: parse JSON strings into a `json` payload, keep
 * anything else as text (mirrors how the langwatch.* branches infer type).
 */
function parseJsonOrText(value: unknown): SpanInputOutput {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return { type: "json", value: toJsonSerializable(parsed) };
      }
    } catch {
      // Not JSON — keep as string
    }

    return { type: "text", value };
  }

  return { type: "json", value: toJsonSerializable(value) };
}

/**
 * Extracts output from canonical span attributes only. After canonicalization, output is at: 1.
 * gen_ai.output.messages (chat messages) 2. langwatch.output (text/json/structured) 3. gen_ai.tool.call.result
 * (tool spans from semconv-native emitters)
 */
export function extractOutput(spanAttributes: NormalizedAttributes): SpanInputOutput | null {
  // Priority 1: gen_ai.output.messages → always chat_messages
  const genAiOutputMessages = spanAttributes["gen_ai.output.messages"];
  if (genAiOutputMessages !== undefined) {
    return {
      type: "chat_messages",
      value: toJsonSerializable(genAiOutputMessages) as ChatMessage[],
    };
  }

  // Priority 2: langwatch.output → use annotated type or infer
  let lwOutput = spanAttributes["langwatch.output"];
  if (lwOutput !== undefined) {
    // ClickHouse Map(String, String) stores objects as JSON strings
    if (typeof lwOutput === "string") {
      try {
        const parsed = JSON.parse(lwOutput);
        if (typeof parsed === "object" && parsed !== null) {
          lwOutput = parsed;
        }
      } catch {
        // Not JSON — keep as string
      }
    }

    // Unwrap {type, value} wrapper preserved by canonicalization (e.g. chat_messages)
    if (isLegacyWrapper(lwOutput)) {
      return unwrapLegacyWrapper(lwOutput, spanAttributes, "langwatch.output");
    }

    const annotatedType = getAnnotatedType(spanAttributes, "langwatch.output");
    if (annotatedType === "chat_messages" && Array.isArray(lwOutput)) {
      return {
        type: "chat_messages",
        value: toJsonSerializable(lwOutput) as ChatMessage[],
      };
    }

    if (annotatedType === "evaluation_result" || annotatedType === "guardrail_result") {
      return {
        type: annotatedType,
        value: toJsonSerializable(lwOutput),
      } as unknown as SpanInputOutput;
    }

    if (annotatedType === "text" || typeof lwOutput === "string") {
      const textValue = typeof lwOutput === "string" ? lwOutput : JSON.stringify(lwOutput);

      return { type: "text", value: textValue };
    }

    return {
      type: "json",
      value: toJsonSerializable(lwOutput),
    };
  }

  // Priority 3: gen_ai.tool.call.result — see extractInput's tool-call twin.
  const toolResult = spanAttributes["gen_ai.tool.call.result"];
  if (toolResult !== undefined) {
    return parseJsonOrText(toolResult);
  }

  return null;
}

/**
 * Extracts model name from canonical span attributes only.
 * After canonicalization, model is at gen_ai.response.model / gen_ai.request.model.
 */
export function extractModel(spanAttributes: NormalizedAttributes): string | null {
  const model = spanAttributes["gen_ai.response.model"] ?? spanAttributes["gen_ai.request.model"];

  return typeof model === "string" ? model : null;
}

/**
 * Extracts vendor from canonical span attributes only.
 * After canonicalization, vendor is at gen_ai.system / gen_ai.provider.name.
 */
export function extractVendor(spanAttributes: NormalizedAttributes): string | null {
  const vendor = spanAttributes["gen_ai.provider.name"] ?? spanAttributes["gen_ai.system"];

  return typeof vendor === "string" ? vendor : null;
}

/**
 * Extracts RAG contexts from canonical span attributes only.
 * After canonicalization, RAG contexts are at langwatch.rag.contexts.
 */
export function extractContexts(spanAttributes: NormalizedAttributes): RAGChunk[] | undefined {
  let contexts = spanAttributes["langwatch.rag.contexts"];

  // ClickHouse Map(String, String) stores arrays as JSON strings
  if (typeof contexts === "string") {
    try {
      contexts = JSON.parse(contexts);
    } catch {
      return undefined;
    }
  }

  if (!contexts || !Array.isArray(contexts)) {
    return undefined;
  }

  return contexts.map((ctx: unknown) => {
    if (typeof ctx === "string") {
      return { content: ctx };
    }

    if (typeof ctx === "object" && ctx !== null) {
      const obj = ctx as Record<string, unknown>;

      return {
        document_id: typeof obj.document_id === "string" ? obj.document_id : null,
        chunk_id: typeof obj.chunk_id === "string" ? obj.chunk_id : null,
        content: obj.content ?? obj,
      };
    }

    return { content: String(ctx) };
  });
}

/**
 * Extracts error information from span status, preferring the OTel exception
 * event's structured attributes over the span-level statusMessage.
 */
export function extractError(
  statusCode: NormalizedStatusCode | null,
  statusMessage: string | null,
  spanAttributes: NormalizedAttributes,
  events: readonly { name: string; attributes: NormalizedAttributes }[],
): ErrorCapture | null {
  if (statusCode !== NormalizedStatusCode.ERROR) {
    return null;
  }

  const exceptionEvents = events.filter((e) => e.name === "exception");
  const latestExceptionEvent =
    exceptionEvents.length > 0 ? exceptionEvents[exceptionEvents.length - 1] : undefined;

  const eventMessage = latestExceptionEvent?.attributes["exception.message"];
  const attrMessage = spanAttributes["exception.message"];

  const errorMessage =
    (typeof eventMessage === "string" && eventMessage.length > 0 ? eventMessage : undefined) ??
    (typeof attrMessage === "string" && attrMessage.length > 0 ? attrMessage : undefined) ??
    statusMessage ??
    "Unknown error";

  const eventStacktrace = latestExceptionEvent?.attributes["exception.stacktrace"];
  const attrStacktrace = spanAttributes["exception.stacktrace"];
  const stacktrace =
    (typeof eventStacktrace === "string" ? eventStacktrace : undefined) ??
    (typeof attrStacktrace === "string" ? attrStacktrace : undefined);
  const stacktraceArray = typeof stacktrace === "string" ? stacktrace.split("\n") : [];

  return {
    has_error: true,
    message: errorMessage,
    stacktrace: stacktraceArray,
  };
}
