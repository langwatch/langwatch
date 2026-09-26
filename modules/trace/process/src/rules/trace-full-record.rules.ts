import {
  EVENTREF_ATTR_PREFIX,
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedAttributes,
  type NormalizedSpan,
  type TraceFullRecordEvent,
  type TraceFullRecordSpan,
  type TraceRecordValue,
} from "@langwatch/trace-contract";

const decimalNumber = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const droppedMarker = "langwatch.privacy.dropped";
const droppedCategoryOrder = ["input", "output", "system", "tools"];
const dangerousPathKeys = new Set(["__proto__", "constructor", "prototype"]);

export type StoredSpanRow = {
  SpanId: string;
  TraceId: string;
  TenantId: string;
  ParentSpanId: string | null;
  ParentTraceId: string | null;
  ParentIsRemote: boolean | null;
  Sampled: boolean;
  StartTimeMs: number;
  EndTimeMs: number;
  DurationMs: number;
  SpanName: string;
  SpanKind: number;
  ResourceAttributes: Record<string, string>;
  SpanAttributes: Record<string, string>;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string | null;
  ScopeVersion: string | null;
  Events_Timestamp: number[] | null;
  Events_Name: string[] | null;
  Events_Attributes: Record<string, string>[] | null;
  Links_TraceId: string[] | null;
  Links_SpanId: string[] | null;
  Links_Attributes: Record<string, string>[] | null;
};

/**
 * Full-record mapping between stored spans and normalized spans; must stay synchronized.
 */
function spanKind(value: number): NormalizedSpanKind {
  const isKnownKind = Object.values(NormalizedSpanKind).includes(value);

  return isKnownKind ? value : NormalizedSpanKind.UNSPECIFIED;
}

function statusCode(value: number | null): NormalizedStatusCode | null {
  if (value === null) return null;
  const isKnownStatus = Object.values(NormalizedStatusCode).includes(value);

  return isKnownStatus ? value : NormalizedStatusCode.UNSET;
}

function jsonValue(value: unknown): TraceRecordValue | null {
  const isScalar =
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
  if (isScalar) return value;
  if (Array.isArray(value)) {
    const values: TraceRecordValue[] = [];
    for (const item of value) {
      const parsed = jsonValue(item);
      if (parsed === null && item !== null) return null;
      values.push(parsed);
    }
    return values;
  }
  if (!isRecord(value)) return null;
  const result: Record<string, TraceRecordValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const parsed = jsonValue(child);
    if (parsed === null && child !== null) return null;
    result[key] = parsed;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, TraceRecordValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function content(type: string, value: TraceRecordValue): { type: string; value: TraceRecordValue } {
  return { type, value };
}

function extractInput(attributes: NormalizedAttributes) {
  return extractContent({
    attributes,
    direction: "input",
    messagesKey: "gen_ai.input.messages",
    toolKey: "gen_ai.tool.call.arguments",
  });
}

function extractOutput(attributes: NormalizedAttributes) {
  return extractContent({
    attributes,
    direction: "output",
    messagesKey: "gen_ai.output.messages",
    toolKey: "gen_ai.tool.call.result",
  });
}

function extractContent({
  attributes,
  direction,
  messagesKey,
  toolKey,
}: {
  attributes: NormalizedAttributes;
  direction: "input" | "output";
  messagesKey: string;
  toolKey: string;
}): { type: string; value: TraceRecordValue } | null {
  const messages = valueAsRecordValue(attributes[messagesKey]);
  if (messages !== void 0) return content("chat_messages", messages);
  const key = `langwatch.${direction}`;
  const direct = valueAsRecordValue(attributes[key]);
  if (direct !== void 0) {
    if (isRecord(direct) && typeof direct.type === "string" && direct.value !== void 0) {
      return content(direct.type, direct.value);
    }
    const annotated = annotatedType(attributes, key);
    if (annotated) return content(annotated, direct);
    return content(typeof direct === "string" ? "text" : "json", direct);
  }
  const tool = valueAsRecordValue(attributes[toolKey]);
  if (tool === void 0) return null;
  if (typeof tool !== "string") return content("json", tool);
  try {
    const parsed = jsonValue(JSON.parse(tool));
    return parsed === null ? content("text", tool) : content("json", parsed);
  } catch {
    return content("text", tool);
  }
}

function valueAsRecordValue(value: unknown): TraceRecordValue | undefined {
  const parsed = jsonValue(value);
  return parsed === null && value !== null ? void 0 : parsed;
}

function annotatedType(attributes: NormalizedAttributes, attribute: string): string | null {
  const value = attributes["langwatch.reserved.value_types"];
  let array: string[] | null;
  if (typeof value === "string") {
    array = parseStringArray(value);
  } else if (Array.isArray(value)) {
    array = value;
  } else {
    array = null;
  }
  if (!array) return null;
  const prefix = `${attribute}=`;
  const item = array.find((entry) => entry.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function extractMetrics(attributes: NormalizedAttributes): Record<string, TraceRecordValue> | null {
  const metrics: Record<string, TraceRecordValue> = {};
  const values: [string, unknown][] = [
    [
      "prompt_tokens",
      attributes["gen_ai.usage.input_tokens"] ?? attributes["gen_ai.usage.prompt_tokens"],
    ],
    [
      "completion_tokens",
      attributes["gen_ai.usage.output_tokens"] ?? attributes["gen_ai.usage.completion_tokens"],
    ],
    ["reasoning_tokens", attributes["gen_ai.usage.reasoning_tokens"]],
    [
      "cache_read_input_tokens",
      attributes["gen_ai.usage.cache_read.input_tokens"] ??
        attributes["gen_ai.usage.cached_input_tokens"],
    ],
    ["cache_creation_input_tokens", attributes["gen_ai.usage.cache_creation.input_tokens"]],
  ];
  for (const [key, value] of values) {
    const number = valueToNumber(value);
    if (number !== null) metrics[key] = number;
  }
  if (typeof attributes["langwatch.tokens.estimated"] === "boolean")
    metrics.tokens_estimated = attributes["langwatch.tokens.estimated"];
  const cost = valueToNumber(attributes["gen_ai.usage.cost"] ?? attributes["langwatch.span.cost"]);
  if (cost !== null && cost > 0) metrics.cost = cost;
  return Object.keys(metrics).length > 0 ? metrics : null;
}

function extractError(
  span: NormalizedSpan,
): { has_error: true; message: string; stacktrace: string[] } | null {
  if (span.statusCode !== NormalizedStatusCode.ERROR) return null;
  const exception = [...span.events].reverse().find((event) => event.name === "exception");
  const eventMessage = exception?.attributes["exception.message"];
  const attrMessage = span.spanAttributes["exception.message"];
  let message: string;
  if (typeof eventMessage === "string" && eventMessage.length > 0) {
    message = eventMessage;
  } else if (typeof attrMessage === "string" && attrMessage.length > 0) {
    message = attrMessage;
  } else {
    message = span.statusMessage ?? "Unknown error";
  }
  const eventStacktrace = exception?.attributes["exception.stacktrace"];
  const attrStacktrace = span.spanAttributes["exception.stacktrace"];
  let stacktrace: string;
  if (typeof eventStacktrace === "string") {
    stacktrace = eventStacktrace;
  } else if (typeof attrStacktrace === "string") {
    stacktrace = attrStacktrace;
  } else {
    stacktrace = "";
  }
  return { has_error: true, message, stacktrace: stacktrace ? stacktrace.split("\n") : [] };
}

function spanType(attributes: NormalizedAttributes): string {
  const value = attributes["langwatch.span.type"];
  return typeof value === "string" ? value : "span";
}

function stringAttribute(
  attributes: NormalizedAttributes,
  first: string,
  second: string,
): string | null {
  const value = attributes[first] ?? attributes[second];
  return typeof value === "string" ? value : null;
}

function extractContexts(attributes: NormalizedAttributes): TraceRecordValue[] | null {
  const value = valueAsRecordValue(attributes["langwatch.rag.contexts"]);
  if (!Array.isArray(value)) return null;
  return value.map((context) => {
    if (typeof context === "string") return { content: context };
    if (isRecord(context)) {
      return {
        document_id: typeof context.document_id === "string" ? context.document_id : null,
        chunk_id: typeof context.chunk_id === "string" ? context.chunk_id : null,
        content: context.content ?? context,
      };
    }
    return { content: JSON.stringify(context) ?? "" };
  });
}

/** Walks (creating as it goes) to the record that holds the last segment of `path`. */
function containerForPath(
  result: Record<string, TraceRecordValue>,
  path: string[],
): Record<string, TraceRecordValue> {
  let current = result;
  for (const part of path.slice(0, -1)) {
    const child = current[part];
    if (!isRecord(child)) current[part] = {};
    const next = current[part];
    if (isRecord(next)) current = next;
  }

  return current;
}

function unflatten(attributes: NormalizedAttributes): Record<string, TraceRecordValue> {
  const result: Record<string, TraceRecordValue> = {};
  for (const [key, raw] of Object.entries(attributes)) {
    const value = valueAsRecordValue(raw);
    if (value === void 0) continue;
    const path = key.split(".");
    const hasDangerousSegment = path.some((part) => dangerousPathKeys.has(part));
    if (hasDangerousSegment) continue;

    const container = containerForPath(result, path);
    container[path[path.length - 1]!] = value;
  }

  return result;
}

function recordAtPath(
  record: Record<string, TraceRecordValue> | null | undefined,
  path: string[],
): TraceRecordValue | undefined {
  let value: TraceRecordValue | undefined = record;
  for (const part of path) {
    if (!isRecord(value)) return void 0;
    value = value[part];
  }
  return value;
}

function valueToNumber(value: unknown): number | null {
  let number: number;
  if (typeof value === "number") {
    number = value;
  } else if (typeof value === "string") {
    number = Number(value);
  } else {
    number = NaN;
  }
  return Number.isFinite(number) ? number : null;
}

function parseStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value);
    const isStringArray = Array.isArray(parsed) && parsed.every((item) => typeof item === "string");

    return isStringArray ? parsed : null;
  } catch {
    return null;
  }
}

function stringArray(value: string | undefined): string[] | null {
  return value === void 0 ? null : parseStringArray(value);
}

function stringArrayOrSingle(value: string): string[] {
  return parseStringArray(value) ?? [value];
}

export function deserializeStoredAttributes(
  raw: Record<string, string> | null | undefined,
): NormalizedAttributes {
  const attributes: NormalizedAttributes = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    attributes[key] = deserializeStoredValue(value);
  }
  return attributes;
}

/** Stored values are strings, but the claim-check value uses the same encoding. */
export function deserializeStoredValue(value: string): TraceRecordValue {
  if (value === "true") return true;
  if (value === "false") return false;

  const trimmed = value.trim();
  const isJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const isJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (isJsonObject || isJsonArray) {
    try {
      return jsonValue(JSON.parse(trimmed)) ?? value;
    } catch {
      return value;
    }
  }

  const numeric = Number(trimmed);
  const unsafeInteger = Number.isInteger(numeric) && Math.abs(numeric) > Number.MAX_SAFE_INTEGER;
  const isSafeDecimal =
    trimmed !== "" && decimalNumber.test(trimmed) && Number.isFinite(numeric) && !unsafeInteger;
  if (isSafeDecimal) {
    return numeric;
  }
  return value;
}

export function mapStoredSpanRow(
  row: StoredSpanRow,
  attributes: NormalizedAttributes,
): NormalizedSpan {
  const events = (row.Events_Timestamp ?? []).map((timeUnixMs, index) => ({
    name: row.Events_Name?.[index] ?? "",
    timeUnixMs,
    attributes: deserializeStoredAttributes(row.Events_Attributes?.[index] ?? {}),
  }));
  const links = (row.Links_TraceId ?? []).map((traceId, index) => ({
    traceId,
    spanId: row.Links_SpanId?.[index] ?? "",
    attributes: deserializeStoredAttributes(row.Links_Attributes?.[index] ?? {}),
  }));

  return {
    id: "",
    traceId: row.TraceId,
    spanId: row.SpanId,
    tenantId: row.TenantId,
    parentSpanId: row.ParentSpanId,
    parentTraceId: row.ParentTraceId,
    parentIsRemote: row.ParentIsRemote,
    sampled: row.Sampled,
    startTimeUnixMs: row.StartTimeMs,
    endTimeUnixMs: row.EndTimeMs,
    durationMs: row.DurationMs,
    name: row.SpanName,
    kind: spanKind(row.SpanKind),
    resourceAttributes: deserializeStoredAttributes(row.ResourceAttributes),
    spanAttributes: attributes,
    events,
    links,
    statusCode: statusCode(row.StatusCode),
    statusMessage: row.StatusMessage,
    instrumentationScope: { name: row.ScopeName ?? "", version: row.ScopeVersion },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

export function mapNormalizedSpanToFullRecordSpan(span: NormalizedSpan): TraceFullRecordSpan {
  const type = spanType(span.spanAttributes);
  const firstToken = span.events.find(
    (event) => event.name === "first_token" || event.name === "gen_ai.content.first_token",
  );
  const base = {
    span_id: span.spanId,
    parent_id: span.parentSpanId,
    trace_id: span.traceId,
    type,
    name: span.name,
    input: extractInput(span.spanAttributes),
    output: extractOutput(span.spanAttributes),
    error: extractError(span),
    timestamps: {
      started_at: span.startTimeUnixMs,
      finished_at: span.endTimeUnixMs,
      first_token_at: firstToken?.timeUnixMs ?? null,
    },
    metrics: extractMetrics(span.spanAttributes),
    params: unflatten(span.spanAttributes),
  };
  if (type === "llm") {
    return {
      ...base,
      model: stringAttribute(span.spanAttributes, "gen_ai.response.model", "gen_ai.request.model"),
      vendor: stringAttribute(span.spanAttributes, "gen_ai.provider.name", "gen_ai.system"),
    };
  }
  if (type === "rag")
    return {
      ...base,
      contexts: extractContexts(span.spanAttributes) ?? [],
    };
  return base;
}

/** One span's event record, or none when the span carries no typed `event`. */
function fullRecordEventOf({
  span,
  projectId,
  traceId,
}: {
  span: TraceFullRecordSpan;
  projectId: string;
  traceId: string;
}): TraceFullRecordEvent | null {
  const event = recordAtPath(span.params, ["event"]);
  if (!isRecord(event)) return null;
  if (typeof event.type !== "string" || event.type.length === 0) return null;

  const metrics: Record<string, number> = {};
  if (isRecord(event.metrics)) {
    for (const [key, value] of Object.entries(event.metrics)) {
      const number = valueToNumber(value);
      if (number !== null) metrics[key] = number;
    }
  }

  const eventDetails: Record<string, string> = {};
  if (isRecord(event.details)) {
    for (const [key, value] of Object.entries(event.details)) {
      if (typeof value === "string") eventDetails[key] = value;
    }
  }

  return {
    event_id: span.span_id,
    event_type: event.type,
    project_id: projectId,
    trace_id: traceId,
    metrics,
    event_details: eventDetails,
    timestamps: {
      started_at: span.timestamps.started_at,
      inserted_at: span.timestamps.started_at,
      updated_at: span.timestamps.finished_at,
    },
  };
}

export function extractFullRecordEvents({
  spans,
  projectId,
  traceId,
}: {
  spans: TraceFullRecordSpan[];
  projectId: string;
  traceId: string;
}): TraceFullRecordEvent[] {
  const events: TraceFullRecordEvent[] = [];
  for (const span of spans) {
    const event = fullRecordEventOf({ span, projectId, traceId });
    if (event) events.push(event);
  }

  return events;
}

/** The attributes that map onto a named metadata key, in the order they are read. */
const PRIMARY_METADATA_KEYS: Readonly<Record<string, string>> = {
  "gen_ai.conversation.id": "thread_id",
  "langwatch.user_id": "user_id",
  "langwatch.customer_id": "customer_id",
  "sdk.name": "sdk_name",
  "sdk.version": "sdk_version",
  "sdk.language": "sdk_language",
  "telemetry.sdk.name": "telemetry_sdk_name",
  "telemetry.sdk.version": "telemetry_sdk_version",
  "telemetry.sdk.language": "telemetry_sdk_language",
};

/** Every attribute that is not a named key travels as its own metadata entry. */
function addRemainingMetadata(
  metadata: Record<string, TraceRecordValue>,
  attributes: Record<string, string>,
): void {
  const skipped = new Set([
    ...Object.keys(PRIMARY_METADATA_KEYS),
    "langgraph.thread_id",
    "langwatch.reserved.model_metadata_stamped",
  ]);
  for (const [key, value] of Object.entries(attributes)) {
    if (skipped.has(key)) continue;
    const bare = key.startsWith("metadata.") ? key.slice("metadata.".length) : key;
    if (bare && metadata[bare] === void 0) metadata[bare] = deserializeStoredValue(value);
  }
}

/** The list-valued metadata: labels, prompt ids, models, and the log record count. */
function addListMetadata(
  metadata: Record<string, TraceRecordValue>,
  attributes: Record<string, string>,
): void {
  const labels = attributes["langwatch.labels"] ?? attributes.labels;
  if (labels !== void 0) metadata.labels = stringArrayOrSingle(labels);
  const promptIds = stringArray(attributes["langwatch.prompt_ids"]);
  if (promptIds) metadata.prompt_ids = promptIds;
  const models = stringArray(attributes["metadata.models"]);
  if (models) metadata.models = models;
  const logRecordCount = attributes["langwatch.reserved.log_record_count"];
  if (logRecordCount !== void 0 && metadata.otel_log_record_count === void 0)
    metadata.otel_log_record_count = deserializeStoredValue(logRecordCount);
}

export function mapTraceMetadata(
  attributes: Record<string, string>,
): Record<string, TraceRecordValue> {
  const metadata: Record<string, TraceRecordValue> = {};
  for (const [attribute, key] of Object.entries(PRIMARY_METADATA_KEYS)) {
    const value = attributes[attribute];
    if (value !== void 0) metadata[key] = deserializeStoredValue(value);
  }

  const fallbackThread = attributes["langgraph.thread_id"];
  if (metadata.thread_id === void 0 && fallbackThread !== void 0)
    metadata.thread_id = deserializeStoredValue(fallbackThread);

  addRemainingMetadata(metadata, attributes);
  addListMetadata(metadata, attributes);

  return metadata;
}

export function collectDroppedCategories(spans: NormalizedSpan[]): string[] {
  const found = new Set<string>();
  for (const span of spans) {
    const marker = span.spanAttributes[droppedMarker];
    if (typeof marker !== "string") continue;
    for (const category of marker.split(",")) {
      const trimmed = category.trim();
      if (trimmed) found.add(trimmed);
    }
  }
  return [
    ...droppedCategoryOrder.filter((category) => found.has(category)),
    ...[...found].filter((category) => !droppedCategoryOrder.includes(category)),
  ];
}

export function withoutEventReferences(attributes: NormalizedAttributes): NormalizedAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !key.startsWith(EVENTREF_ATTR_PREFIX)),
  );
}
