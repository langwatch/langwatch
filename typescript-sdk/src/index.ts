import {
  type Strict,
  camelToSnakeCaseNested,
  type SnakeToCamelCaseNested,
} from "./helpers";
import {
  type Trace,
  type Span as ServerSpan,
  type BaseSpan as ServerBaseSpan,
  type SpanTypes,
  type LLMSpan as ServerLLMSpan,
  type RAGSpan as ServerRAGSpan,
  type CollectorRESTParams,
  type SpanInputOutput as ServerSpanInputOutput,
  type ChatMessage as ServerChatMessage,
} from "./server/types/tracer";
import { nanoid } from "nanoid";
import {
  collectorRESTParamsSchema,
  spanSchema,
} from "./server/types/tracer.generated";
import type modelPrices from "llm-cost/model_prices_and_context_window.json";
import EventEmitter from "events";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import type { OpenAI } from "openai";

export type Metadata = SnakeToCamelCaseNested<Trace["metadata"]>;

// Check to see if out ChatMessage type is compatible with OpenAIChatCompletion messages
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ =
  {} as OpenAI.Chat.ChatCompletionMessageParam satisfies ServerChatMessage;

// Keep the input/output types signatures as snake case to match the official openai nodejs api
export type SpanInputOutput =
  | SnakeToCamelCaseNested<Exclude<ServerSpanInputOutput, ServerChatMessage>>
  | ServerChatMessage;

export type ConvertServerSpan<T extends ServerBaseSpan> =
  SnakeToCamelCaseNested<
    Omit<T, "input" | "outputs"> & {
      input?: SpanInputOutput | null;
      outputs: SpanInputOutput[];
    }
  >;

export type PendingSpan<T extends BaseSpan> = Omit<
  T,
  "traceId" | "timestamps"
> & {
  timestamps: Omit<T["timestamps"], "finishedAt"> & {
    finishedAt?: number | null;
  };
};

export type BaseSpan = ConvertServerSpan<ServerBaseSpan>;
export type PendingBaseSpan = PendingSpan<BaseSpan>;

// vendor is deprecated, and we try to force the available models here
export type LLMSpan = ConvertServerSpan<
  Omit<ServerLLMSpan, "vendor" | "model">
> & { model: keyof typeof modelPrices | "unknown" };
export type PendingLLMSpan = PendingSpan<LLMSpan>;

export type RAGSpan = ConvertServerSpan<ServerRAGSpan>;
export type PendingRAGSpan = PendingSpan<RAGSpan>;

export class LangWatch extends EventEmitter {
  apiKey: string | undefined;
  endpoint: string;

  constructor({
    apiKey,
    endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
  }: {
    apiKey?: string;
    endpoint?: string;
  } = {}) {
    super();
    const apiKey_ = apiKey ?? process.env.LANGWATCH_API_KEY;
    if (!apiKey_) {
      console.warn(
        "[LangWatch] ⚠️ LangWatch API key is not set, please set the LANGWATCH_API_KEY environment variable or pass it in the constructor. Traces will not be captured."
      );
    }
    this.apiKey = apiKey_;
    this.endpoint = endpoint;
  }

  getTrace(traceId?: string, metadata?: Metadata) {
    return new LangWatchTrace({
      client: this,
      traceId: traceId ?? `trace_${nanoid()}`,
      metadata,
    });
  }

  async sendTrace(params: CollectorRESTParams) {
    const backoff = [1000, 2000, 4000, 8000, 16000];
    for (const backoffTime of backoff) {
      try {
        await this._sendTrace(params);
        return;
      } catch (e) {
        console.warn(
          `[LangWatch] ⚠️ Failed to send trace, retrying in ${
            backoffTime / 1000
          }s`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
      }
    }
  }

  async _sendTrace(params: CollectorRESTParams) {
    if (params.spans.length === 0) {
      return;
    }

    if (!this.apiKey) {
      const error = new Error(
        "[LangWatch] ⚠️ LangWatch API key is not set, LLMs traces will not be sent, go to https://langwatch.ai to set it up"
      );
      this.emit("error", error);
      console.warn(error.message);
      return;
    }

    const response = await fetch(`${this.endpoint}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (response.status === 429) {
      const error = new Error(
        "[LangWatch] ⚠️ Rate limit exceeded, dropping message from being sent to LangWatch. Please check your dashboard to upgrade your plan."
      );
      this.emit("error", error);
      console.warn(error.message);
      return;
    }
    if (!response.ok) {
      const error = new Error(
        `[LangWatch] ⚠️ Failed to send trace, status: ${response.status}`
      );
      this.emit("error", error);
      throw error;
    }
  }
}

export class LangWatchTrace {
  client: LangWatch;
  traceId: string;
  metadata?: Metadata;
  finishedSpans: Record<string, ServerSpan> = {};
  timeoutRef?: NodeJS.Timeout;

  constructor({
    client,
    traceId,
    metadata,
  }: {
    client: LangWatch;
    traceId: string;
    metadata?: Metadata;
  }) {
    this.client = client;
    this.traceId = traceId;
    this.metadata = metadata;
  }

  update({ metadata }: { metadata: Metadata }) {
    this.metadata = {
      ...this.metadata,
      ...metadata,
    };
  }

  startSpan(params: Omit<Partial<PendingBaseSpan>, "parentId">) {
    const span = new LangWatchSpan({
      trace: this,
      ...params,
    });
    return span;
  }

  startLLMSpan(params: Omit<Partial<PendingLLMSpan>, "parentId">) {
    const span = new LangWatchLLMSpan({
      trace: this,
      ...params,
    });
    return span;
  }

  startRAGSpan(params: Omit<Partial<PendingRAGSpan>, "parentId">) {
    const span = new LangWatchRAGSpan({
      trace: this,
      ...params,
    });
    return span;
  }

  onEnd(span: ServerSpan) {
    this.finishedSpans[span.span_id] = span;
    this.delayedSendSpans();
  }

  delayedSendSpans() {
    clearTimeout(this.timeoutRef);
    this.timeoutRef = setTimeout(() => {
      void this.sendSpans();
    }, 1000);
  }

  async sendSpans() {
    clearTimeout(this.timeoutRef);

    let trace: CollectorRESTParams | undefined = undefined;
    try {
      trace = collectorRESTParamsSchema.parse({
        trace_id: this.traceId,
        metadata: camelToSnakeCaseNested(this.metadata),
        spans: Object.values(this.finishedSpans),
      } as Strict<CollectorRESTParams>);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn("[LangWatch] ⚠️ Failed to parse trace");
        console.warn(fromZodError(error).message);
      } else {
        console.warn(error);
      }
      this.client.emit("error", error);
    }

    if (trace) {
      await this.client.sendTrace(trace);
    }
  }
}

export class LangWatchSpan implements PendingBaseSpan {
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
    this.spanId = spanId ?? `span_${nanoid()}`;
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

  startSpan(params: Omit<Partial<PendingBaseSpan>, "parentId">) {
    const span = new LangWatchSpan({
      trace: this.trace,
      parentId: this.spanId,
      ...params,
    });
    return span;
  }

  startLLMSpan(params: Omit<Partial<PendingLLMSpan>, "parentId">) {
    const span = new LangWatchLLMSpan({
      trace: this.trace,
      parentId: this.spanId,
      ...params,
    });
    return span;
  }

  startRAGSpan(params: Omit<Partial<PendingRAGSpan>, "parentId">) {
    const span = new LangWatchRAGSpan({
      trace: this.trace,
      parentId: this.spanId,
      ...params,
    });
    return span;
  }

  end(params?: Partial<Omit<PendingBaseSpan, "spanId" | "parentId">>) {
    this.timestamps.finishedAt = Date.now();
    if (params) {
      this.update(params);
    }

    try {
      const finalSpan = spanSchema.parse(
        camelToSnakeCaseNested({
          ...this,
          trace: undefined,
          traceId: this.trace.traceId,
          timestamps: {
            ...this.timestamps,
            finishedAt: this.timestamps.finishedAt,
          },
        }) as ServerSpan
      );
      this.trace.onEnd(finalSpan);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn("[LangWatch] ⚠️ Failed to parse span");
        console.warn(fromZodError(error).message);
      } else {
        console.warn(error);
      }
      this.trace.client.emit("error", error);
    }
  }
}

export class LangWatchLLMSpan extends LangWatchSpan implements PendingLLMSpan {
  type: "llm";
  model: PendingLLMSpan["model"];
  params: PendingLLMSpan["params"];

  constructor(params: Partial<PendingLLMSpan> & { trace: LangWatchTrace }) {
    super({ ...params });
    this.type = "llm";
    this.model = params.model ?? "unknown";
    this.params = params.params ?? {};
  }

  update(params: Partial<PendingLLMSpan>) {
    super.update(params);
    if (params.model) {
      this.model = params.model;
    }
    if (params.params) {
      this.params = params.params;
    }
  }
}

export class LangWatchRAGSpan extends LangWatchSpan implements PendingRAGSpan {
  type: "rag";
  contexts: PendingRAGSpan["contexts"];

  constructor(params: Partial<PendingRAGSpan> & { trace: LangWatchTrace }) {
    super({ ...params });
    this.type = "rag";
    this.contexts = params.contexts ?? [];
  }

  update(params: Partial<PendingRAGSpan>) {
    super.update(params);
    if (params.contexts) {
      this.contexts = params.contexts;
    }
  }
}
