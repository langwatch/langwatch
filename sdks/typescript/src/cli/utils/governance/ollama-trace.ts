/**
 * Turn one observed Ollama HTTP exchange into one LangWatch LLM span. Ollama
 * has no telemetry configuration, so the wire between its CLI and its server
 * is the only place a prompt and its completion are both visible; the proxy
 * reads them there (ollama-proxy.ts) and this module decides what they mean.
 * Pure: bodies in, an OTLP/JSON payload out.
 */

import { randomBytes } from "node:crypto";

/** The request shapes this module knows how to read. */
export type OllamaRoute = "chat" | "generate" | "openai-chat";

/**
 * Which route a request path belongs to, or null for everything else. The
 * rest of the API — pulls, pushes, the model list, blob uploads — carries no
 * prompt and is forwarded unread.
 */
export function ollamaRouteFor(pathname: string): OllamaRoute | null {
  const path = pathname.split("?")[0]?.replace(/\/+$/, "") ?? "";
  if (path === "/api/chat") return "chat";
  if (path === "/api/generate") return "generate";
  if (path === "/v1/chat/completions") return "openai-chat";
  return null;
}

/** One request/response pair the proxy watched go by. */
export interface OllamaExchange {
  route: OllamaRoute;
  /** Verbatim request body. */
  requestBody: string;
  /** Verbatim response body, streamed chunks included, in arrival order. */
  responseBody: string;
  status: number;
  startedAtMs: number;
  endedAtMs: number;
}

/** OTLP/JSON attribute, in the one encoding the exporter accepts. */
type OtlpAttribute = {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { boolValue: boolean }
    | { doubleValue: number };
};

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code?: number; message?: string };
}

export interface OtlpExportRequest {
  resourceSpans: unknown[];
}

/**
 * The ceiling on a captured prompt or completion, in characters. Past this a
 * span is one nobody can render and an upload nobody wants, so the value is
 * truncated with a marker rather than dropped.
 */
const MAX_CAPTURED_CHARS = 128_000;

/** Longest error body kept as the span's status message. */
const MAX_STATUS_MESSAGE_CHARS = 1_000;

/** Marks where a chat message's base64 image data was left out. */
const IMAGE_PLACEHOLDER_PREFIX = "<image omitted, ";

/** 2 is ERROR in the OTLP status enum; a healthy span names no status. */
const OTLP_STATUS_ERROR = 2;

function stringAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): OtlpAttribute {
  return { key, value: { intValue: String(Math.trunc(value)) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  if (value.length <= MAX_CAPTURED_CHARS) return value;
  return `${value.slice(0, MAX_CAPTURED_CHARS)}… [truncated by langwatch at ${MAX_CAPTURED_CHARS} characters]`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** One JSON object, or null when the text is not one. */
function tryParseRecord(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    // Not one object: the caller falls through to the line framings.
    return null;
  }
}

/**
 * Read a response body as a list of JSON records, whichever framing Ollama
 * used: one object (not streamed), newline-delimited JSON (streamed native),
 * or Server-Sent Events (streamed OpenAI-compatible). A line that does not
 * parse is skipped, so a stream cut off mid-chunk still reports every
 * complete chunk before the cut.
 */
export function parseResponseRecords(body: string): Record<string, unknown>[] {
  const trimmed = body.trim();
  if (trimmed === "") return [];
  const single = tryParseRecord(trimmed);
  if (single) return [single];

  const records: Record<string, unknown>[] = [];
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim();
    const payload = line.startsWith("data:") ? line.slice("data:".length).trim() : line;
    if (payload === "" || payload === "[DONE]") continue;
    const record = tryParseRecord(payload);
    if (record) records.push(record);
  }
  return records;
}

/** Replace base64 image payloads in a chat message list with a size note. */
function redactImages(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    const carriesImages = isRecord(message) && Array.isArray(message.images);
    if (!carriesImages) return message;
    return {
      ...message,
      images: (message.images as unknown[]).map((image) =>
        typeof image === "string"
          ? `${IMAGE_PLACEHOLDER_PREFIX}${image.length} characters>`
          : image,
      ),
    };
  });
}

/** What the caller asked for, as the span records it. */
interface RequestReading {
  model: string | null;
  /** The `langwatch.input` value, already JSON-encoded. */
  input: string | null;
  stream: boolean | null;
  temperature: number | null;
}

const EMPTY_REQUEST: RequestReading = {
  model: null,
  input: null,
  stream: null,
  temperature: null,
};

/** The prompt, in the envelope the LangWatch receiver reads. */
function readInput(route: OllamaRoute, parsed: Record<string, unknown>): string | null {
  if (route === "generate") {
    const prompt = parsed.prompt;
    if (typeof prompt !== "string") return null;
    return JSON.stringify({ type: "text", value: truncate(prompt) });
  }
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return null;
  return truncate(JSON.stringify({ type: "chat_messages", value: redactImages(messages) }));
}

/**
 * Native Ollama streams unless told not to and nests sampling under
 * `options`; the OpenAI-compatible surface does neither. Reading both here
 * keeps the difference out of the span.
 */
function readRequest(route: OllamaRoute, body: string): RequestReading {
  const parsed = tryParseRecord(body);
  if (!parsed) return EMPTY_REQUEST;

  const nativeOptions = isRecord(parsed.options) ? parsed.options : {};
  const streamedByDefault = route !== "openai-chat";
  return {
    model: typeof parsed.model === "string" ? parsed.model : null,
    input: readInput(route, parsed),
    stream: typeof parsed.stream === "boolean" ? parsed.stream : streamedByDefault,
    temperature: numberOrNull(
      route === "openai-chat" ? parsed.temperature : nativeOptions.temperature,
    ),
  };
}

/** What came back, assembled across however many chunks carried it. */
interface ResponseReading {
  model: string | null;
  output: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
}

/** One chunk of an OpenAI-compatible answer: deltas, or the whole message. */
function readOpenAiRecord(
  record: Record<string, unknown>,
  reading: ResponseReading,
  parts: string[],
): void {
  for (const choice of Array.isArray(record.choices) ? record.choices : []) {
    if (!isRecord(choice)) continue;
    const delta = isRecord(choice.delta) ? choice.delta : null;
    const message = isRecord(choice.message) ? choice.message : null;
    const content = delta?.content ?? message?.content;
    if (typeof content === "string") parts.push(content);
    if (typeof choice.finish_reason === "string") reading.finishReason = choice.finish_reason;
  }
  // Present on a non-streamed answer, and on the last chunk of a streamed one
  // when the caller asked for usage.
  const usage = isRecord(record.usage) ? record.usage : null;
  reading.inputTokens = numberOrNull(usage?.prompt_tokens) ?? reading.inputTokens;
  reading.outputTokens = numberOrNull(usage?.completion_tokens) ?? reading.outputTokens;
}

/** One chunk of a native answer, from either native route. */
function readNativeRecord(
  route: OllamaRoute,
  record: Record<string, unknown>,
  reading: ResponseReading,
  parts: string[],
): void {
  if (route === "generate") {
    if (typeof record.response === "string") parts.push(record.response);
  } else {
    const message = isRecord(record.message) ? record.message : null;
    if (typeof message?.content === "string") parts.push(message.content);
    const toolCalls = message?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      parts.push(JSON.stringify({ tool_calls: toolCalls }));
    }
  }
  reading.inputTokens = numberOrNull(record.prompt_eval_count) ?? reading.inputTokens;
  reading.outputTokens = numberOrNull(record.eval_count) ?? reading.outputTokens;
  if (typeof record.done_reason === "string") reading.finishReason = record.done_reason;
}

function readResponse(route: OllamaRoute, body: string): ResponseReading {
  const reading: ResponseReading = {
    model: null,
    output: "",
    inputTokens: null,
    outputTokens: null,
    finishReason: null,
  };
  const parts: string[] = [];

  for (const record of parseResponseRecords(body)) {
    if (typeof record.model === "string") reading.model = record.model;
    if (route === "openai-chat") {
      readOpenAiRecord(record, reading, parts);
    } else {
      readNativeRecord(route, record, reading, parts);
    }
  }

  reading.output = truncate(parts.join(""));
  return reading;
}

/** Randomly generated OTLP ids; overridable so a test can assert on them. */
export interface SpanIdGenerator {
  traceId(): string;
  spanId(): string;
}

const defaultIdGenerator: SpanIdGenerator = {
  traceId: () => randomBytes(16).toString("hex"),
  spanId: () => randomBytes(8).toString("hex"),
};

const SPAN_NAME_BY_ROUTE: Record<OllamaRoute, string> = {
  chat: "ollama.chat",
  generate: "ollama.generate",
  "openai-chat": "ollama.chat",
};

const OPERATION_BY_ROUTE: Record<OllamaRoute, string> = {
  chat: "chat",
  generate: "text_completion",
  "openai-chat": "chat",
};

/** The attributes describing what was asked and what came back. */
function spanAttributes(
  route: OllamaRoute,
  request: RequestReading,
  response: ResponseReading,
  status: number,
): OtlpAttribute[] {
  const attributes: OtlpAttribute[] = [
    stringAttr("langwatch.span.type", "llm"),
    stringAttr("gen_ai.provider.name", "ollama"),
    stringAttr("gen_ai.operation.name", OPERATION_BY_ROUTE[route]),
  ];
  const responseModel = response.model ?? request.model;

  if (request.input !== null) attributes.push(stringAttr("langwatch.input", request.input));
  if (response.output !== "") attributes.push(stringAttr("langwatch.output", response.output));
  if (request.model !== null) attributes.push(stringAttr("gen_ai.request.model", request.model));
  if (responseModel !== null) attributes.push(stringAttr("gen_ai.response.model", responseModel));
  if (request.stream !== null) {
    attributes.push({ key: "gen_ai.request.stream", value: { boolValue: request.stream } });
  }
  if (request.temperature !== null) {
    attributes.push({
      key: "gen_ai.request.temperature",
      value: { doubleValue: request.temperature },
    });
  }
  if (response.inputTokens !== null) {
    attributes.push(intAttr("gen_ai.usage.input_tokens", response.inputTokens));
  }
  if (response.outputTokens !== null) {
    attributes.push(intAttr("gen_ai.usage.output_tokens", response.outputTokens));
  }
  if (response.finishReason !== null) {
    attributes.push(stringAttr("gen_ai.response.finish_reasons", response.finishReason));
  }
  if (status >= 400) attributes.push(intAttr("http.response.status_code", status));

  return attributes;
}

/**
 * Build the span for one exchange, or null when the exchange said nothing a
 * span could carry — a request body that was not JSON, or one naming neither
 * a model nor a prompt. A refused call still produces a span: a failed
 * generation is a fact about the session, and the status carries the reason.
 */
export function buildOllamaSpan(
  exchange: OllamaExchange,
  ids: SpanIdGenerator = defaultIdGenerator,
): OtlpSpan | null {
  const request = readRequest(exchange.route, exchange.requestBody);
  const saidNothing = request.input === null && request.model === null;
  if (saidNothing) return null;

  const response = readResponse(exchange.route, exchange.responseBody);
  const failed = exchange.status >= 400;
  const endMs = Math.max(exchange.startedAtMs, exchange.endedAtMs);

  return {
    traceId: ids.traceId(),
    spanId: ids.spanId(),
    name: SPAN_NAME_BY_ROUTE[exchange.route],
    kind: 1,
    startTimeUnixNano: `${exchange.startedAtMs}000000`,
    endTimeUnixNano: `${endMs}000000`,
    attributes: spanAttributes(exchange.route, request, response, exchange.status),
    status: failed
      ? {
          code: OTLP_STATUS_ERROR,
          message: exchange.responseBody.trim().slice(0, MAX_STATUS_MESSAGE_CHARS),
        }
      : {},
  };
}

/**
 * Wrap spans in the OTLP export envelope. The scope is a `langwatch.*` name
 * for the same reason the codex harvest uses one: the ingestion side filters
 * infrastructure spans by scope, and these carry the content.
 */
export function buildOllamaExportRequest(spans: OtlpSpan[]): OtlpExportRequest {
  return {
    resourceSpans: [
      {
        resource: { attributes: [stringAttr("service.name", "ollama")] },
        scopeSpans: [{ scope: { name: "langwatch.ollama" }, spans }],
      },
    ],
  };
}
