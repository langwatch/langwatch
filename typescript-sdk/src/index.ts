import EventEmitter from "eventemitter3";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { version } from "../package.json";
import {
  evaluate,
  type EvaluationParams,
  type EvaluationResultModel,
} from "./evaluations";
import { LangWatchCallbackHandler } from "./langchain";
import {
  type CollectorRESTParams,
  type EvaluationResult,
  type Span as ServerSpan,
  type SpanTypes,
  type TypedValueEvaluationResult,
} from "./server/types/tracer";
import {
  collectorRESTParamsSchema,
  spanSchema,
} from "./server/types/tracer.generated";
import {
  type Trace,
  type BaseSpan,
  type ChatMessage,
  type ChatRichContent,
  type LLMSpan,
  type Metadata,
  type PendingBaseSpan,
  type PendingLLMSpan,
  type PendingRAGSpan,
  type RAGSpan,
  type RESTEvaluation,
  type SpanInputOutput,
  type LLMModeTrace,
} from "./types";
import { camelToSnakeCaseNested, type Strict } from "./typeUtils";
import {
  autoconvertTypedValues,
  captureError,
  convertFromVercelAIMessages,
} from "./utils";
import { LangWatchExporter } from "./LangWatchExporter";

export type {
  Trace,
  BaseSpan,
  ChatMessage as ChatMessage,
  ChatRichContent,
  LLMSpan,
  Metadata,
  PendingBaseSpan,
  PendingLLMSpan,
  PendingRAGSpan,
  RAGSpan,
  SpanInputOutput,
  LLMModeTrace,
};

export {
  autoconvertTypedValues,
  captureError,
  convertFromVercelAIMessages,
  LangWatchExporter,
};

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
      const error = new Error(
        "LangWatch API key is not set, please set the LANGWATCH_API_KEY environment variable or pass it in the constructor. Traces will not be captured."
      );
      this.emit("error", error);
    }
    this.apiKey = apiKey_;
    this.endpoint = endpoint;
  }

  getTrace({
    traceId,
    metadata,
  }: { traceId?: string; metadata?: Metadata } = {}) {
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
    console.warn("[LangWatch] ⚠️ Failed to send trace, giving up");
  }

  async _sendTrace(params: CollectorRESTParams) {
    if (params.spans.length === 0) {
      return;
    }

    if (!this.apiKey) {
      const error = new Error(
        "LangWatch API key is not set, LLMs traces will not be sent, go to https://langwatch.ai to set it up"
      );
      this.emit("error", error);
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
        "Rate limit exceeded, dropping message from being sent to LangWatch. Please check your dashboard to upgrade your plan."
      );
      this.emit("error", error);
      return;
    }
    if (!response.ok) {
      const error = new Error(
        `Failed to send trace, status: ${response.status}`
      );
      this.emit("error", error);
      throw error;
    }
  }
}

type CurrentSpan = {
  current: LangWatchSpan;
  previous?: CurrentSpan;
};

type AddEvaluationParams = {
  evaluationId?: string;
  span?: LangWatchSpan;
  name: string;
  type?: string;
  isGuardrail?: boolean;
  status?: "processed" | "skipped" | "error";
  passed?: boolean;
  score?: number;
  label?: string;
  details?: string;
  error?: Error;
  timestamps?: RESTEvaluation["timestamps"];
};

export class LangWatchTrace {
  client: LangWatch;
  traceId: string;
  metadata?: Metadata;
  finishedSpans: Record<string, ServerSpan> = {};
  langchainCallback?: LangWatchCallbackHandler;
  evaluations: RESTEvaluation[] = [];
  private currentSpan?: CurrentSpan;
  private timeoutRef?: NodeJS.Timeout;

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
    this.metadata = {
      ...metadata,
      sdkVersion: version,
      sdkLanguage: "typescript",
    };
  }

  update({ metadata }: { metadata: Metadata }) {
    this.metadata = {
      ...this.metadata,
      ...metadata,
      ...(typeof metadata.labels !== "undefined"
        ? {
            labels: [
              ...(this.metadata?.labels ?? []),
              ...(metadata.labels ?? []),
            ],
          }
        : {}),
    };
  }

  setCurrentSpan(span: LangWatchSpan) {
    this.currentSpan = {
      current: span,
      previous: this.currentSpan,
    };
  }

  getCurrentSpan() {
    return this.currentSpan?.current;
  }

  resetCurrentSpan() {
    this.currentSpan = this.currentSpan?.previous;
  }

  startSpan(params: Omit<Partial<PendingBaseSpan>, "parentId">) {
    const span = new LangWatchSpan({
      trace: this,
      ...params,
    });
    this.setCurrentSpan(span);
    return span;
  }

  startLLMSpan(params: Omit<Partial<PendingLLMSpan>, "parentId">) {
    const span = new LangWatchLLMSpan({
      trace: this,
      ...params,
    });
    this.setCurrentSpan(span);
    return span;
  }

  startRAGSpan(params: Omit<Partial<PendingRAGSpan>, "parentId">) {
    const span = new LangWatchRAGSpan({
      trace: this,
      ...params,
    });
    this.setCurrentSpan(span);
    return span;
  }

  addEvaluation = ({
    evaluationId,
    span,
    name,
    type,
    isGuardrail,
    status = "processed",
    passed,
    score,
    label,
    details,
    error,
    timestamps,
  }: AddEvaluationParams): void => {
    const currentEvaluationIndex = this.evaluations.findIndex(
      (e) =>
        evaluationId && "evaluationId" in e && e.evaluationId === evaluationId
    );

    const currentEvaluation =
      currentEvaluationIndex !== -1
        ? this.evaluations[currentEvaluationIndex]
        : undefined;

    const evaluationResult: EvaluationResult = {
      status,
      ...(passed !== undefined && { passed }),
      ...(score !== undefined && { score }),
      ...(label !== undefined && { label }),
      ...(details !== undefined && { details }),
    };

    let span_ = span;
    if (!span_) {
      span_ = this.startSpan({
        type: "evaluation",
      });
    }
    if (span_.type !== "evaluation") {
      span_ = span_.startSpan({ type: "evaluation" });
    }

    span_.update({
      name,
      output: {
        type: "evaluation_result",
        value: evaluationResult,
      } as TypedValueEvaluationResult,
      error,
      timestamps: timestamps
        ? {
            startedAt: timestamps.startedAt ?? span_.timestamps.startedAt,
            finishedAt: timestamps.finishedAt ?? undefined,
          }
        : undefined,
    });
    span_.end();

    const evaluation: RESTEvaluation = {
      evaluationId: evaluationId ?? `eval_${nanoid()}`,
      spanId: span_.spanId,
      name,
      type,
      isGuardrail,
      status,
      passed,
      score,
      label,
      details,
      error: error ? captureError(error) : undefined,
      timestamps: timestamps ?? {
        startedAt: span_.timestamps.startedAt,
        finishedAt: span_.timestamps.finishedAt,
      },
    };

    if (currentEvaluation && currentEvaluationIndex !== -1) {
      this.evaluations[currentEvaluationIndex] = {
        ...currentEvaluation,
        ...evaluation,
      };
    } else {
      this.evaluations.push(evaluation);
    }
  };

  async evaluate(params: EvaluationParams): Promise<EvaluationResultModel> {
    return evaluate({
      trace: this,
      ...params,
    });
  }

  getLangChainCallback() {
    if (!this.langchainCallback) {
      this.langchainCallback = new LangWatchCallbackHandler({ trace: this });
    }
    return this.langchainCallback;
  }

  onEnd(span: ServerSpan) {
    this.finishedSpans[span.span_id] = span;
    this.resetCurrentSpan();
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
        metadata: camelToSnakeCaseNested(this.metadata, "metadata"),
        spans: Object.values(this.finishedSpans),
        evaluations: camelToSnakeCaseNested(this.evaluations),
      } as Strict<CollectorRESTParams>);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn("[LangWatch] ⚠️ Failed to parse trace");
        console.warn(fromZodError(error).message);
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
  input?: PendingBaseSpan["input"];
  output?: PendingBaseSpan["output"];
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
    output,
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
    this.output = output;
    this.error = error;
    this.timestamps = timestamps ?? {
      startedAt: Date.now(),
    };
    this.metrics = metrics;
  }

  update(params: Partial<Omit<PendingBaseSpan, "spanId" | "parentId">>) {
    if (Object.isFrozen(this)) {
      const error = new Error(
        `Tried to update span ${this.spanId}, but the span is already finished, discarding update`
      );
      this.trace.client.emit("error", error);
      return;
    }

    if (params.type) {
      this.type = params.type;
    }
    if ("name" in params) {
      this.name = params.name;
    }
    if ("input" in params) {
      this.input = params.input;
    }
    if ("output" in params) {
      this.output = params.output;
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
    this.trace.setCurrentSpan(span);
    return span;
  }

  startLLMSpan(params: Omit<Partial<PendingLLMSpan>, "parentId">) {
    const span = new LangWatchLLMSpan({
      trace: this.trace,
      parentId: this.spanId,
      ...params,
    });
    this.trace.setCurrentSpan(span);
    return span;
  }

  startRAGSpan(params: Omit<Partial<PendingRAGSpan>, "parentId">) {
    const span = new LangWatchRAGSpan({
      trace: this.trace,
      parentId: this.spanId,
      ...params,
    });
    this.trace.setCurrentSpan(span);
    return span;
  }

  addEvaluation(params: AddEvaluationParams) {
    this.trace.addEvaluation({
      ...params,
      span: this,
    });
  }

  async evaluate(params: EvaluationParams): Promise<EvaluationResultModel> {
    return evaluate({
      span: this,
      ...params,
    });
  }

  end(params?: Partial<Omit<PendingBaseSpan, "spanId" | "parentId">>) {
    this.timestamps.finishedAt = Date.now();
    if (params) {
      this.update(params);
    }

    Object.freeze(this);

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
          ...(this.error && { error: captureError(this.error) }),
        }) as ServerSpan
      );
      this.trace.onEnd(finalSpan);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn("[LangWatch] ⚠️ Failed to parse span");
        console.warn(fromZodError(error).message);
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

  end(params?: Partial<PendingLLMSpan>) {
    super.end(params);
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

  end(params?: Partial<PendingRAGSpan>) {
    super.end(params);
  }
}
