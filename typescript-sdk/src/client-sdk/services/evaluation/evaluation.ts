/**
 * Evaluation - Main class for running batch evaluations
 *
 * Provides a clean API for running evaluations over datasets with:
 * - Automatic tracing per iteration
 * - Parallel execution with concurrency control
 * - Batched result sending
 * - Built-in evaluator support
 * - Multi-target comparison
 */

import { trace, context, SpanStatusCode } from "@opentelemetry/api";
import { createLangWatchSpan } from "@/observability-sdk/span/implementation";
import type { LangWatchSpan } from "@/observability-sdk/span/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import type { Logger } from "@/logger";
import { generateHumanReadableId } from "./humanReadableId";
import {
  EvaluationInitError,
  EvaluationApiError,
  TargetMetadataConflictError,
  EvaluatorError,
} from "./errors";
import type {
  Batch,
  BatchEntry,
  EvaluationResult,
  TargetInfo,
  TargetMetadata,
  EvaluationInitOptions,
  LogOptions,
  EvaluateOptions,
  RunOptions,
  RunCallback,
  RunContext,
  ExperimentInitResponse,
  LogResultsRequest,
  RunEvaluatorResponse,
} from "./types";

const DEFAULT_CONCURRENCY = 4;
const DEBOUNCE_INTERVAL_MS = 1000;

/**
 * Evaluation session for running batch evaluations
 */
export class Evaluation {
  readonly name: string;
  readonly runId: string;
  readonly experimentSlug: string;

  private readonly apiClient: LangwatchApiClient;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly logger: Logger;
  private readonly concurrency: number;

  private initialized = false;
  private createdAtMs: number;
  private total = 0;
  private progress = 0;

  // Batching state
  private batch: Batch = { dataset: [], evaluations: [], targets: [] };
  private lastSentMs = 0;
  private pendingFlush: Promise<void> | null = null;
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;

  // Target registry
  private targets: Map<string, TargetInfo> = new Map();

  // Current iteration context (for log/evaluate calls)
  private currentTraceId: string | null = null;

  private constructor(
    name: string,
    options: {
      apiClient: LangwatchApiClient;
      endpoint: string;
      apiKey: string;
      logger: Logger;
      runId?: string;
      concurrency?: number;
    }
  ) {
    this.name = name;
    this.experimentSlug = name;
    this.runId = options.runId ?? generateHumanReadableId();
    this.apiClient = options.apiClient;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.logger = options.logger;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.createdAtMs = Date.now();
  }

  /**
   * Initialize an evaluation session
   */
  static async init(
    name: string,
    options: {
      apiClient: LangwatchApiClient;
      endpoint: string;
      apiKey: string;
      logger: Logger;
    } & EvaluationInitOptions
  ): Promise<Evaluation> {
    const evaluation = new Evaluation(name, options);
    await evaluation.initialize();
    return evaluation;
  }

  /**
   * Initialize the evaluation by creating/getting the experiment
   */
  private async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new EvaluationInitError(
        "API key is required. Set LANGWATCH_API_KEY or pass apiKey to LangWatch constructor."
      );
    }

    try {
      const response = await fetch(`${this.endpoint}/api/experiment/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": this.apiKey,
        },
        body: JSON.stringify({
          experiment_name: this.name,
          experiment_slug: this.experimentSlug,
          experiment_type: "BATCH_EVALUATION_V2",
        }),
      });

      if (response.status === 401) {
        throw new EvaluationInitError("Invalid API key");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new EvaluationInitError(`Failed to initialize experiment: ${text}`);
      }

      const data = (await response.json()) as ExperimentInitResponse;
      (this as { experimentSlug: string }).experimentSlug = data.slug;

      const encodedRunId = encodeURIComponent(this.runId);
      console.log(`Follow results at: ${this.endpoint}${data.path}?runId=${encodedRunId}`);

      this.initialized = true;
    } catch (error) {
      if (error instanceof EvaluationInitError) {
        throw error;
      }
      throw new EvaluationInitError(
        `Failed to initialize evaluation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Run evaluation over a dataset with a callback
   *
   * @param dataset - Array of items to evaluate
   * @param callback - Function called for each item with { item, index, span }
   * @param options - Concurrency options
   *
   * @example
   * ```typescript
   * await evaluation.run(dataset, async ({ item, index, span }) => {
   *   const response = await myAgent(item.question);
   *   evaluation.log('accuracy', { index, score: 0.95 });
   * }, { concurrency: 4 });
   * ```
   */
  async run<T>(
    dataset: T[],
    callback: RunCallback<T>,
    options?: RunOptions
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const concurrency = options?.concurrency ?? this.concurrency;
    this.total = dataset.length;
    this.progress = 0;

    const tracer = trace.getTracer("langwatch-evaluation");

    // Process items with concurrency control
    const executing = new Set<Promise<void>>();

    for (let index = 0; index < dataset.length; index++) {
      const item = dataset[index] as T;

      const itemPromise = this.executeItem(tracer, item, index, callback);

      executing.add(itemPromise);
      itemPromise.finally(() => executing.delete(itemPromise));

      // Wait if we've hit concurrency limit
      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    // Wait for all remaining items
    await Promise.all(executing);

    // Send final batch with finished timestamp
    await this.flush(true);
  }

  /**
   * Execute a single item in the dataset
   */
  private async executeItem<T>(
    tracer: ReturnType<typeof trace.getTracer>,
    item: T,
    index: number,
    callback: RunCallback<T>
  ): Promise<void> {
    const startTime = Date.now();
    let error: Error | undefined;

    await tracer.startActiveSpan(
      "evaluation.iteration",
      {
        attributes: {
          "evaluation.run_id": this.runId,
          "evaluation.index": index,
        },
      },
      async (otelSpan) => {
        const span = createLangWatchSpan(otelSpan);
        const spanContext = otelSpan.spanContext();
        const traceId = spanContext.traceId;

        // Set current trace ID for log/evaluate calls
        this.currentTraceId = traceId;

        try {
          const ctx: RunContext<T> = { item, index, span };
          const result = callback(ctx);

          if (result && typeof result.then === "function") {
            await result;
          }

          span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.recordException(error);
          this.logger.error(`Evaluation error at index ${index}:`, error);
        } finally {
          span.end();
          this.currentTraceId = null;
        }
      }
    );

    // Add to batch
    const duration = Date.now() - startTime;
    const entry: BatchEntry = {
      index,
      entry: this.serializeItem(item),
      duration,
      error: error?.message ?? null,
      trace_id: this.currentTraceId ?? this.getTraceIdFromContext(),
    };

    this.batch.dataset.push(entry);
    this.progress++;

    // Debounced send
    this.scheduleSend();
  }

  /**
   * Log a custom metric result
   *
   * @param metric - Name of the metric
   * @param options - Metric options including index, score, passed, etc.
   *
   * @example
   * ```typescript
   * evaluation.log('accuracy', { index, score: 0.95 });
   * evaluation.log('has_citation', { index, passed: true });
   * evaluation.log('quality', {
   *   index,
   *   score: 0.8,
   *   target: 'gpt4',
   *   metadata: { model: 'gpt-4', temperature: 0.7 }
   * });
   * ```
   */
  log(metric: string, options: LogOptions): void {
    const {
      index,
      data = {},
      score,
      passed,
      label,
      details,
      status = options.error ? "error" : "processed",
      duration,
      cost,
      error,
      target,
      metadata,
    } = options;

    // Register target if provided
    let targetId: string | undefined;
    if (target) {
      targetId = this.registerTarget(target, metadata);
    }

    const traceId = this.currentTraceId ?? this.getTraceIdFromContext();

    const result: EvaluationResult = {
      name: metric,
      evaluator: metric,
      trace_id: traceId,
      status,
      data,
      score: score ?? null,
      passed: passed ?? null,
      details: details ?? (error ? error.message : null),
      index,
      label: label ?? null,
      cost: cost ?? null,
      duration: duration ?? null,
      error_type: error ? error.name : null,
      traceback: error ? [error.stack ?? error.message] : null,
      target_id: targetId ?? null,
    };

    this.batch.evaluations.push(result);
    this.scheduleSend();
  }

  /**
   * Run a built-in evaluator
   *
   * @param evaluatorSlug - The evaluator identifier (e.g., 'ragas/faithfulness')
   * @param options - Evaluator options including data and settings
   *
   * @example
   * ```typescript
   * await evaluation.evaluate('ragas/faithfulness', {
   *   index,
   *   data: {
   *     input: item.question,
   *     output: response.text,
   *     contexts: response.contexts,
   *   },
   *   settings: { model: 'openai/gpt-4' },
   * });
   * ```
   */
  async evaluate(evaluatorSlug: string, options: EvaluateOptions): Promise<void> {
    const {
      index,
      data,
      settings,
      name,
      asGuardrail = false,
      target,
      metadata,
    } = options;

    const startTime = Date.now();
    const traceId = this.currentTraceId ?? this.getTraceIdFromContext();
    const spanId = this.getSpanIdFromContext();

    try {
      const response = await fetch(
        `${this.endpoint}/api/evaluations/${evaluatorSlug}/evaluate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": this.apiKey,
          },
          body: JSON.stringify({
            trace_id: traceId || null,
            span_id: spanId || null,
            name: name ?? evaluatorSlug,
            data,
            settings,
            as_guardrail: asGuardrail,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new EvaluatorError(evaluatorSlug, text);
      }

      const result = (await response.json()) as RunEvaluatorResponse;
      const duration = Date.now() - startTime;

      // Log the result
      this.log(name ?? evaluatorSlug, {
        index,
        data,
        status: result.status,
        score: result.score ?? undefined,
        passed: result.passed ?? undefined,
        details: result.details ?? undefined,
        label: result.label ?? undefined,
        duration,
        cost: result.cost?.amount,
        target,
        metadata,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof EvaluatorError) {
        this.log(name ?? evaluatorSlug, {
          index,
          data,
          status: "error",
          duration,
          error: error,
          target,
          metadata,
        });
        throw error;
      }

      const wrappedError = new EvaluatorError(
        evaluatorSlug,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );

      this.log(name ?? evaluatorSlug, {
        index,
        data,
        status: "error",
        duration,
        error: wrappedError,
        target,
        metadata,
      });

      throw wrappedError;
    }
  }

  /**
   * Register a target for multi-target comparison
   */
  private registerTarget(name: string, metadata?: TargetMetadata): string {
    const existing = this.targets.get(name);

    if (existing) {
      // Check for metadata conflict
      if (metadata) {
        const existingMeta = existing.metadata ?? {};
        if (JSON.stringify(existingMeta) !== JSON.stringify(metadata)) {
          throw new TargetMetadataConflictError(name, existingMeta, metadata);
        }
      }
      return name;
    }

    // Register new target
    const targetInfo: TargetInfo = {
      id: name,
      name,
      type: "custom",
      metadata: metadata ?? null,
    };

    this.targets.set(name, targetInfo);
    this.batch.targets.push(targetInfo);

    return name;
  }

  /**
   * Schedule a debounced send
   */
  private scheduleSend(): void {
    const now = Date.now();

    if (now - this.lastSentMs >= DEBOUNCE_INTERVAL_MS) {
      this.sendBatch();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => {
        this.flushTimeout = null;
        this.sendBatch();
      }, DEBOUNCE_INTERVAL_MS - (now - this.lastSentMs));
    }
  }

  /**
   * Send current batch to the API
   */
  private sendBatch(finished = false): void {
    if (
      this.batch.dataset.length === 0 &&
      this.batch.evaluations.length === 0 &&
      this.batch.targets.length === 0 &&
      !finished
    ) {
      return;
    }

    const body: LogResultsRequest = {
      experiment_slug: this.experimentSlug,
      name: this.name,
      run_id: this.runId,
      dataset: this.batch.dataset.map((entry) => ({
        index: entry.index,
        entry: entry.entry,
        duration: entry.duration,
        error: entry.error,
        trace_id: entry.trace_id,
      })),
      evaluations: this.batch.evaluations.map((e) => ({
        name: e.name,
        evaluator: e.evaluator,
        trace_id: e.trace_id,
        status: e.status,
        inputs: e.data,
        score: e.score,
        passed: e.passed,
        details: e.details,
        index: e.index,
        label: e.label,
        cost: e.cost,
        duration: e.duration,
        target_id: e.target_id,
      })),
      targets: this.batch.targets,
      progress: this.progress,
      total: this.total,
      timestamps: {
        created_at: this.createdAtMs,
        finished_at: finished ? Date.now() : null,
      },
    };

    // Fire and forget (with error logging)
    this.pendingFlush = fetch(`${this.endpoint}/api/evaluations/batch/log_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
      .then((response) => {
        if (!response.ok) {
          this.logger.error(`Failed to send batch: ${response.status}`);
        }
      })
      .catch((error) => {
        this.logger.error("Failed to send batch:", error);
      });

    // Clear batch
    this.batch = { dataset: [], evaluations: [], targets: [] };
    this.lastSentMs = Date.now();
  }

  /**
   * Flush all pending data
   */
  private async flush(finished = false): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    this.sendBatch(finished);

    if (this.pendingFlush) {
      await this.pendingFlush;
    }
  }

  /**
   * Serialize a dataset item for the API
   */
  private serializeItem(item: unknown): unknown {
    if (item === null || item === undefined) {
      return item;
    }

    if (typeof item === "object") {
      // Handle objects with toJSON method
      if ("toJSON" in item && typeof (item as { toJSON: unknown }).toJSON === "function") {
        return (item as { toJSON: () => unknown }).toJSON();
      }
      // Return as-is, JSON.stringify will handle it
      return item;
    }

    return item;
  }

  /**
   * Get trace ID from current OpenTelemetry context
   */
  private getTraceIdFromContext(): string {
    const span = trace.getActiveSpan();
    if (span) {
      return span.spanContext().traceId;
    }
    return "";
  }

  /**
   * Get span ID from current OpenTelemetry context
   */
  private getSpanIdFromContext(): string | null {
    const span = trace.getActiveSpan();
    if (span) {
      return span.spanContext().spanId;
    }
    return null;
  }
}
