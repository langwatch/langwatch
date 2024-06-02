import { camelToSnakeCaseNested, type SnakeToCamelCaseNested } from "./helpers";
import {
  type Trace,
  type Span as ServerSpan,
  type BaseSpan as ServerBaseSpan,
  type SpanTypes,
} from "./server/types/tracer";
import { nanoid } from "nanoid";
import { spanSchema } from "./server/types/tracer.generated";

export type Metadata = SnakeToCamelCaseNested<Trace["metadata"]>;
export type BaseSpan = SnakeToCamelCaseNested<ServerBaseSpan>;
export type PendingBaseSpan = Omit<BaseSpan, "traceId" | "timestamps"> & {
  timestamps: Omit<BaseSpan["timestamps"], "finishedAt"> & {
    finishedAt?: number | null;
  };
};

class LangWatch {
  apiKey: string | undefined;
  endpoint: string;

  constructor({
    apiKey,
    endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
  }: {
    apiKey?: string;
    endpoint?: string;
  } = {}) {
    const apiKey_ = apiKey ?? process.env.LANGWATCH_API_KEY;
    if (!apiKey_) {
      console.warn(
        "⚠️ LangWatch API key is not set, please set the LANGWATCH_API_KEY environment variable or pass it in the constructor. Traces will not be captured."
      );
    }
    this.apiKey = apiKey_;
    this.endpoint = endpoint;
  }

  getTrace(traceId?: string, metadata?: Metadata) {
    return new LangWatchTrace(traceId ?? nanoid(), metadata);
  }
}

class LangWatchTrace {
  id: string;
  metadata?: Metadata;
  enqueued: Record<string, ServerSpan> = {};

  constructor(id: string, metadata?: Metadata) {
    this.id = id;
    this.metadata = metadata;
  }

  update({ metadata }: { metadata: Metadata }) {
    this.metadata = {
      ...this.metadata,
      ...metadata,
    };
  }

  startSpan(params: Omit<Partial<PendingBaseSpan>, "parentId" | "traceId">) {
    const span = new LangWatchSpan({
      trace: this,
      parentId: null,
      ...params,
    });
    return span;
  }

  onEnd(span: ServerSpan) {
    this.enqueued[span.span_id] = span;
  }
}

class LangWatchSpan implements PendingBaseSpan {
  trace: LangWatchTrace;

  spanId: string;
  parentId?: string | null;
  type: SpanTypes;
  name?: string | null;
  input: PendingBaseSpan["input"];
  outputs: PendingBaseSpan["outputs"];
  error?: PendingBaseSpan["error"];
  timestamps: PendingBaseSpan["timestamps"];
  metrics: PendingBaseSpan["metrics"];

  constructor({
    trace,
    spanId,
    parentId,
    type,
    name,
    input,
    outputs,
    error,
    timestamps,
    metrics,
  }: Partial<PendingBaseSpan> & { trace: LangWatchTrace }) {
    this.spanId = spanId ?? nanoid();
    this.parentId = parentId;
    this.trace = trace;
    this.type = type ?? "span";
    this.name = name;
    this.input = input;
    this.outputs = outputs ?? [];
    this.error = error;
    this.timestamps = timestamps ?? {
      startedAt: Date.now(),
    };
    this.metrics = metrics;
  }

  update(params: Partial<Omit<PendingBaseSpan, "spanId" | "parentId">>) {
    if (params.type) {
      this.type = params.type;
    }
    if ("name" in params) {
      this.name = params.name;
    }
    if ("input" in params) {
      this.input = params.input;
    }
    if (params.outputs) {
      this.outputs = params.outputs;
    }
    if ("error" in params) {
      this.error = params.error;
    }
    if (params.timestamps) {
      this.timestamps = params.timestamps;
    }
    if ("metrics" in params) {
      this.metrics = params.metrics;
    }
  }

  end(params?: Partial<Omit<PendingBaseSpan, "spanId" | "parentId">>) {
    this.timestamps.finishedAt = Date.now();
    if (params) {
      this.update(params);
    }

    const finalSpan = spanSchema.parse(
      camelToSnakeCaseNested({
        ...this,
        traceId: this.trace.id,
        timestamps: {
          ...this.timestamps,
          finishedAt: this.timestamps.finishedAt,
        },
      }) as ServerSpan
    );
    this.trace.onEnd(finalSpan);
  }
}

export { LangWatch };
