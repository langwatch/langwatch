import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedAttributes,
  type NormalizedSpan,
  type TraceFullRecordEvent,
  type TraceFullRecordSpan,
  type TraceRecordValue,
} from "@langwatch/trace-contract";

const decimalNumber = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const eventReferencePrefix = "langwatch.reserved.eventref.";
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
 * A stored span row, and a normalized span, as the full-record shape the trace
 * detail view reads.
 *
 * Both directions live here because they have to agree: what the writer
 * flattens, the reader unflattens, and a change to one that misses the other
 * shows up as an attribute that silently stops rendering. Eight entry points,
 * and twenty-one steps that exist only to serve them.
 */
export class TraceFullRecordMapper {
  private static spanKind(value: number): NormalizedSpanKind {
    return Object.values(NormalizedSpanKind).includes(value)
      ? value
      : NormalizedSpanKind.UNSPECIFIED;
  }

  private static statusCode(value: number | null): NormalizedStatusCode | null {
    if (value === null) return null;
    return Object.values(NormalizedStatusCode).includes(value) ? value : NormalizedStatusCode.UNSET;
  }

  private static jsonValue(value: unknown): TraceRecordValue | null {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return value;
    if (Array.isArray(value)) {
      const values: TraceRecordValue[] = [];
      for (const item of value) {
        const parsed = TraceFullRecordMapper.jsonValue(item);
        if (parsed === null && item !== null) return null;
        values.push(parsed);
      }
      return values;
    }
    if (!TraceFullRecordMapper.isRecord(value)) return null;
    const result: Record<string, TraceRecordValue> = {};
    for (const [key, child] of Object.entries(value)) {
      const parsed = TraceFullRecordMapper.jsonValue(child);
      if (parsed === null && child !== null) return null;
      result[key] = parsed;
    }
    return result;
  }

  private static isRecord(value: unknown): value is Record<string, TraceRecordValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private static content(
    type: string,
    value: TraceRecordValue,
  ): { type: string; value: TraceRecordValue } {
    return { type, value };
  }

  private static extractInput(attributes: NormalizedAttributes) {
    return TraceFullRecordMapper.extractContent(
      attributes,
      "input",
      "gen_ai.input.messages",
      "gen_ai.tool.call.arguments",
    );
  }

  private static extractOutput(attributes: NormalizedAttributes) {
    return TraceFullRecordMapper.extractContent(
      attributes,
      "output",
      "gen_ai.output.messages",
      "gen_ai.tool.call.result",
    );
  }

  private static extractContent(
    attributes: NormalizedAttributes,
    direction: "input" | "output",
    messagesKey: string,
    toolKey: string,
  ): { type: string; value: TraceRecordValue } | null {
    const messages = TraceFullRecordMapper.valueAsRecordValue(attributes[messagesKey]);
    if (messages !== void 0) return TraceFullRecordMapper.content("chat_messages", messages);
    const key = `langwatch.${direction}`;
    const direct = TraceFullRecordMapper.valueAsRecordValue(attributes[key]);
    if (direct !== void 0) {
      if (
        TraceFullRecordMapper.isRecord(direct) &&
        typeof direct.type === "string" &&
        direct.value !== void 0
      ) {
        return TraceFullRecordMapper.content(direct.type, direct.value);
      }
      const annotated = TraceFullRecordMapper.annotatedType(attributes, key);
      if (annotated) return TraceFullRecordMapper.content(annotated, direct);
      return TraceFullRecordMapper.content(typeof direct === "string" ? "text" : "json", direct);
    }
    const tool = TraceFullRecordMapper.valueAsRecordValue(attributes[toolKey]);
    if (tool === void 0) return null;
    if (typeof tool !== "string") return TraceFullRecordMapper.content("json", tool);
    try {
      const parsed = TraceFullRecordMapper.jsonValue(JSON.parse(tool));
      return parsed === null
        ? TraceFullRecordMapper.content("text", tool)
        : TraceFullRecordMapper.content("json", parsed);
    } catch {
      return TraceFullRecordMapper.content("text", tool);
    }
  }

  private static valueAsRecordValue(value: unknown): TraceRecordValue | undefined {
    const parsed = TraceFullRecordMapper.jsonValue(value);
    return parsed === null && value !== null ? void 0 : parsed;
  }

  private static annotatedType(attributes: NormalizedAttributes, attribute: string): string | null {
    const value = attributes["langwatch.reserved.value_types"];
    const array =
      typeof value === "string"
        ? TraceFullRecordMapper.parseStringArray(value)
        : Array.isArray(value)
          ? value
          : null;
    if (!array) return null;
    const prefix = `${attribute}=`;
    const item = array.find((entry) => entry.startsWith(prefix));
    return item ? item.slice(prefix.length) : null;
  }

  private static extractMetrics(
    attributes: NormalizedAttributes,
  ): Record<string, TraceRecordValue> | null {
    const metrics: Record<string, TraceRecordValue> = {};
    const values: Array<[string, unknown]> = [
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
      const number = TraceFullRecordMapper.valueToNumber(value);
      if (number !== null) metrics[key] = number;
    }
    if (typeof attributes["langwatch.tokens.estimated"] === "boolean")
      metrics.tokens_estimated = attributes["langwatch.tokens.estimated"];
    const cost = TraceFullRecordMapper.valueToNumber(
      attributes["gen_ai.usage.cost"] ?? attributes["langwatch.span.cost"],
    );
    if (cost !== null && cost > 0) metrics.cost = cost;
    return Object.keys(metrics).length > 0 ? metrics : null;
  }

  private static extractError(
    span: NormalizedSpan,
  ): { has_error: true; message: string; stacktrace: string[] } | null {
    if (span.statusCode !== NormalizedStatusCode.ERROR) return null;
    const exception = [...span.events].reverse().find((event) => event.name === "exception");
    const eventMessage = exception?.attributes["exception.message"];
    const attrMessage = span.spanAttributes["exception.message"];
    const message =
      typeof eventMessage === "string" && eventMessage.length > 0
        ? eventMessage
        : typeof attrMessage === "string" && attrMessage.length > 0
          ? attrMessage
          : (span.statusMessage ?? "Unknown error");
    const eventStacktrace = exception?.attributes["exception.stacktrace"];
    const attrStacktrace = span.spanAttributes["exception.stacktrace"];
    const stacktrace =
      typeof eventStacktrace === "string"
        ? eventStacktrace
        : typeof attrStacktrace === "string"
          ? attrStacktrace
          : "";
    return { has_error: true, message, stacktrace: stacktrace ? stacktrace.split("\n") : [] };
  }

  private static spanType(attributes: NormalizedAttributes): string {
    const value = attributes["langwatch.span.type"];
    return typeof value === "string" ? value : "span";
  }

  private static stringAttribute(
    attributes: NormalizedAttributes,
    first: string,
    second: string,
  ): string | null {
    const value = attributes[first] ?? attributes[second];
    return typeof value === "string" ? value : null;
  }

  private static extractContexts(attributes: NormalizedAttributes): TraceRecordValue[] | null {
    const value = TraceFullRecordMapper.valueAsRecordValue(attributes["langwatch.rag.contexts"]);
    if (!Array.isArray(value)) return null;
    return value.map((context) => {
      if (typeof context === "string") return { content: context };
      if (TraceFullRecordMapper.isRecord(context)) {
        return {
          document_id: typeof context.document_id === "string" ? context.document_id : null,
          chunk_id: typeof context.chunk_id === "string" ? context.chunk_id : null,
          content: context.content ?? context,
        };
      }
      return { content: String(context) };
    });
  }

  private static unflatten(attributes: NormalizedAttributes): Record<string, TraceRecordValue> {
    const result: Record<string, TraceRecordValue> = {};
    for (const [key, raw] of Object.entries(attributes)) {
      const value = TraceFullRecordMapper.valueAsRecordValue(raw);
      if (value === void 0) continue;
      const path = key.split(".");
      if (path.some((part) => dangerousPathKeys.has(part))) continue;
      let current = result;
      for (const [index, part] of path.entries()) {
        if (index === path.length - 1) {
          current[part] = value;
          continue;
        }
        const child = current[part];
        if (!TraceFullRecordMapper.isRecord(child)) current[part] = {};
        const next = current[part];
        if (TraceFullRecordMapper.isRecord(next)) current = next;
      }
    }
    return result;
  }

  private static recordAtPath(
    record: Record<string, TraceRecordValue> | null | undefined,
    path: string[],
  ): TraceRecordValue | undefined {
    let value: TraceRecordValue | undefined = record;
    for (const part of path) {
      if (!TraceFullRecordMapper.isRecord(value)) return void 0;
      value = value[part];
    }
    return value;
  }

  private static valueToNumber(value: unknown): number | null {
    const number =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
  }

  private static parseStringArray(value: string): string[] | null {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private static stringArray(value: string | undefined): string[] | null {
    return value === void 0 ? null : TraceFullRecordMapper.parseStringArray(value);
  }

  private static stringArrayOrSingle(value: string): string[] {
    return TraceFullRecordMapper.parseStringArray(value) ?? [value];
  }

  static deserializeStoredAttributes(
    raw: Record<string, string> | null | undefined,
  ): NormalizedAttributes {
    const attributes: NormalizedAttributes = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      attributes[key] = TraceFullRecordMapper.deserializeStoredValue(value);
    }
    return attributes;
  }

  /** Stored values are strings, but the claim-check value uses the same encoding. */
  static deserializeStoredValue(value: string): TraceRecordValue {
    if (value === "true") return true;
    if (value === "false") return false;

    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return TraceFullRecordMapper.jsonValue(JSON.parse(trimmed)) ?? value;
      } catch {
        return value;
      }
    }

    const numeric = Number(trimmed);
    const unsafeInteger = Number.isInteger(numeric) && Math.abs(numeric) > Number.MAX_SAFE_INTEGER;
    if (
      trimmed !== "" &&
      decimalNumber.test(trimmed) &&
      Number.isFinite(numeric) &&
      !unsafeInteger
    ) {
      return numeric;
    }
    return value;
  }

  static mapStoredSpanRow(row: StoredSpanRow, attributes: NormalizedAttributes): NormalizedSpan {
    const events = (row.Events_Timestamp ?? []).map((timeUnixMs, index) => ({
      name: row.Events_Name?.[index] ?? "",
      timeUnixMs,
      attributes: TraceFullRecordMapper.deserializeStoredAttributes(
        row.Events_Attributes?.[index] ?? {},
      ),
    }));
    const links = (row.Links_TraceId ?? []).map((traceId, index) => ({
      traceId,
      spanId: row.Links_SpanId?.[index] ?? "",
      attributes: TraceFullRecordMapper.deserializeStoredAttributes(
        row.Links_Attributes?.[index] ?? {},
      ),
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
      kind: TraceFullRecordMapper.spanKind(row.SpanKind),
      resourceAttributes: TraceFullRecordMapper.deserializeStoredAttributes(row.ResourceAttributes),
      spanAttributes: attributes,
      events,
      links,
      statusCode: TraceFullRecordMapper.statusCode(row.StatusCode),
      statusMessage: row.StatusMessage,
      instrumentationScope: { name: row.ScopeName ?? "", version: row.ScopeVersion },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      cost: null,
      nonBilledCost: null,
    };
  }

  static mapNormalizedSpanToFullRecordSpan(span: NormalizedSpan): TraceFullRecordSpan {
    const type = TraceFullRecordMapper.spanType(span.spanAttributes);
    const firstToken = span.events.find(
      (event) => event.name === "first_token" || event.name === "gen_ai.content.first_token",
    );
    const base = {
      span_id: span.spanId,
      parent_id: span.parentSpanId,
      trace_id: span.traceId,
      type,
      name: span.name,
      input: TraceFullRecordMapper.extractInput(span.spanAttributes),
      output: TraceFullRecordMapper.extractOutput(span.spanAttributes),
      error: TraceFullRecordMapper.extractError(span),
      timestamps: {
        started_at: span.startTimeUnixMs,
        finished_at: span.endTimeUnixMs,
        first_token_at: firstToken?.timeUnixMs ?? null,
      },
      metrics: TraceFullRecordMapper.extractMetrics(span.spanAttributes),
      params: TraceFullRecordMapper.unflatten(span.spanAttributes),
    };
    if (type === "llm") {
      return {
        ...base,
        model: TraceFullRecordMapper.stringAttribute(
          span.spanAttributes,
          "gen_ai.response.model",
          "gen_ai.request.model",
        ),
        vendor: TraceFullRecordMapper.stringAttribute(
          span.spanAttributes,
          "gen_ai.provider.name",
          "gen_ai.system",
        ),
      };
    }
    if (type === "rag")
      return {
        ...base,
        contexts: TraceFullRecordMapper.extractContexts(span.spanAttributes) ?? [],
      };
    return base;
  }

  static extractFullRecordEvents({
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
      const event = TraceFullRecordMapper.recordAtPath(span.params, ["event"]);
      if (
        !TraceFullRecordMapper.isRecord(event) ||
        typeof event.type !== "string" ||
        event.type.length === 0
      )
        continue;
      const metrics: Record<string, number> = {};
      if (TraceFullRecordMapper.isRecord(event.metrics)) {
        for (const [key, value] of Object.entries(event.metrics)) {
          const number = TraceFullRecordMapper.valueToNumber(value);
          if (number !== null) metrics[key] = number;
        }
      }
      const eventDetails: Record<string, string> = {};
      if (TraceFullRecordMapper.isRecord(event.details)) {
        for (const [key, value] of Object.entries(event.details)) {
          if (typeof value === "string") eventDetails[key] = value;
        }
      }
      events.push({
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
      });
    }
    return events;
  }

  static mapTraceMetadata(attributes: Record<string, string>): Record<string, TraceRecordValue> {
    const metadata: Record<string, TraceRecordValue> = {};
    const primary: Record<string, string> = {
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
    for (const [attribute, key] of Object.entries(primary)) {
      const value = attributes[attribute];
      if (value !== void 0) metadata[key] = TraceFullRecordMapper.deserializeStoredValue(value);
    }
    const fallbackThread = attributes["langgraph.thread_id"];
    if (metadata.thread_id === void 0 && fallbackThread !== void 0)
      metadata.thread_id = TraceFullRecordMapper.deserializeStoredValue(fallbackThread);
    const skipped = new Set([
      ...Object.keys(primary),
      "langgraph.thread_id",
      "langwatch.reserved.model_metadata_stamped",
    ]);
    for (const [key, value] of Object.entries(attributes)) {
      if (skipped.has(key)) continue;
      const bare = key.startsWith("metadata.") ? key.slice("metadata.".length) : key;
      if (bare && metadata[bare] === void 0)
        metadata[bare] = TraceFullRecordMapper.deserializeStoredValue(value);
    }
    const labels = attributes["langwatch.labels"] ?? attributes.labels;
    if (labels !== void 0) metadata.labels = TraceFullRecordMapper.stringArrayOrSingle(labels);
    const promptIds = TraceFullRecordMapper.stringArray(attributes["langwatch.prompt_ids"]);
    if (promptIds) metadata.prompt_ids = promptIds;
    const models = TraceFullRecordMapper.stringArray(attributes["metadata.models"]);
    if (models) metadata.models = models;
    const logRecordCount = attributes["langwatch.reserved.log_record_count"];
    if (logRecordCount !== void 0 && metadata.otel_log_record_count === void 0)
      metadata.otel_log_record_count = TraceFullRecordMapper.deserializeStoredValue(logRecordCount);
    return metadata;
  }

  static collectDroppedCategories(spans: NormalizedSpan[]): string[] {
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

  static withoutEventReferences(attributes: NormalizedAttributes): NormalizedAttributes {
    return Object.fromEntries(
      Object.entries(attributes).filter(([key]) => !key.startsWith(eventReferencePrefix)),
    );
  }
}
