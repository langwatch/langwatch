/**
 * Experiment - Main class for running batch experiments
 *
 * Provides a clean API for running experiments over datasets with:
 * - Automatic tracing per iteration
 * - Parallel execution with concurrency control
 * - Batched result sending
 * - Built-in evaluator support
 * - Multi-target comparison with withTarget() context isolation
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { trace, SpanStatusCode, ROOT_CONTEXT } from "@opentelemetry/api";
import { createLangWatchSpan } from "@/observability-sdk/span/implementation";
import type { LangWatchSpan } from "@/observability-sdk/span/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import type { Logger } from "@/logger";
import { ensureSetup } from "@/observability-sdk/setup/node";
import { resolveEndpoint } from "@/internal/endpoint";
import { generateHumanReadableId } from "./humanReadableId";
import {
  ExperimentInitError,
  TargetMetadataConflictError,
  ComparisonError,
  EvaluatorError,
} from "./errors";
import type {
  Batch,
  BatchEntry,
  ComparisonOptions,
  ComparisonVerdict,
  EvaluationResult,
  TargetInfo,
  TargetMetadata,
  ExperimentInitOptions,
  LogOptions,
  EvaluateOptions,
  RunOptions,
  RunCallback,
  RunContext,
  ExperimentInitResponse,
  LogResultsRequest,
  RunEvaluatorResponse,
  TargetCallback,
  TargetResult,
  TargetExecutionContext,
  TargetContext,
} from "./types";
import type { CapturedTargetOutput } from "./comparison";
import {
  COMPARISON_EVALUATOR_SLUG,
  DEFAULT_COMPARISON_NAME,
  buildComparisonCandidates,
  buildComparisonData,
  buildComparisonSettings,
  comparisonEntryLabel,
  comparisonEntryStatus,
  describeSkippedComparison,
  renderTargetOutput,
  toComparisonVerdict,
} from "./comparison";
import { printSummary } from "./printSummary";
import { buildAuthHeaders } from "@/internal/api/auth";

const DEFAULT_CONCURRENCY = 4;
const DEBOUNCE_INTERVAL_MS = 1000;

/**
 * How many rows of captured target outputs compare() keeps around.
 *
 * A comparison runs while its row is still being processed, and at most
 * `concurrency` rows are ever in flight, so this bound sits orders of
 * magnitude above what any run needs while keeping memory flat over a dataset
 * of any size.
 */
const MAX_COMPARISON_ROWS_RETAINED = 1000;

/**
 * How long an evaluator call may take before the socket is given up on.
 *
 * The ceiling has to clear the slowest legitimate judge: a comparison with
 * swap-and-reconcile on makes two sequential LLM calls over every candidate
 * the row produced, and a large reasoning model can spend minutes on each. It
 * exists because the alternative is worse: a judge that accepts the socket and
 * never answers would hold its slot in the concurrency window for the life of
 * the process, so a single dead connection stalls the whole run rather than
 * costing it one row. This is the ceiling the Python SDK already applies to
 * the same endpoint.
 */
export const EVALUATOR_TIMEOUT_MS = 900_000;

// Slim projections retained across the lifetime of an Experiment for
// printSummary() — deliberately excludes large fields (inputs, tracebacks,
// outputs) so running thousands of items doesn't unbound memory.
type SummaryEvaluation = Pick<
  EvaluationResult,
  "name" | "evaluator" | "status" | "passed" | "score" | "cost" | "target_id"
>;
type SummaryEntry = Pick<BatchEntry, "duration" | "error" | "cost" | "target_id">;

/**
 * AsyncLocalStorage for iteration context isolation.
 * This stores the current item, index and trace for each iteration,
 * preventing race conditions in concurrent execution.
 *
 * `traceId` is the row's own iteration trace, and is null for a row whose
 * targets each opened a trace of their own: there is no single trace such a
 * row belongs to, and naming one would attribute its comparison to a trace
 * that judged something else.
 */
type IterationContext = {
  index: number;
  item: unknown;
  traceId: string | null;
};
const iterationContextStorage = new AsyncLocalStorage<IterationContext>();

/**
 * AsyncLocalStorage for target context isolation.
 * This allows log() calls inside withTarget() to automatically
 * infer the target without explicit specification.
 */
const targetContextStorage = new AsyncLocalStorage<TargetExecutionContext>();

/**
 * Experiment session for running batch experiments
 */
export class Experiment {
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

  // Cumulative record for printSummary() — never cleared, mirrors batch.
  // Store only the fields printSummary() needs, not the full payloads —
  // inputs/tracebacks/outputs can be large and don't belong in retained summary state.
  private cumulativeEvaluations: SummaryEvaluation[] = [];
  private cumulativeEntries: SummaryEntry[] = [];
  private runUrl = "";

  // Target registry
  private targets = new Map<string, TargetInfo>();

  // Per-row target outputs for compare(), keyed by row then by target name.
  // Captured when a withTarget() callback resolves and kept independently of
  // the batch, which is flushed on a timer and may be long gone by the time
  // the row is compared. Insertion-ordered, and reaped oldest-first past
  // MAX_COMPARISON_ROWS_RETAINED.
  private capturedOutputs = new Map<number, Map<string, CapturedTargetOutput>>();

  // Track whether withTarget() was used in the current iteration
  // If so, we don't create dataset entries in executeItem()
  // Note: This is now checked via iterationContextStorage to be thread-safe
  private iterationUsedWithTarget = new Map<number, boolean>();

  // Track whether withTarget() has EVER been used in this evaluation
  // Once set to true, we stop creating iteration-level traces
  private evaluationUsesTargets = false;

  private constructor(
    name: string,
    options: {
      apiClient: LangwatchApiClient;
      endpoint: string;
      apiKey: string;
      logger: Logger;
      runId?: string;
      concurrency?: number;
    },
  ) {
    this.name = name;
    this.experimentSlug = name;
    this.runId = options.runId ?? generateHumanReadableId();
    this.apiClient = options.apiClient;
    this.endpoint = resolveEndpoint(options.endpoint);
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
    } & ExperimentInitOptions,
  ): Promise<Experiment> {
    // Ensure observability is set up for proper tracing
    ensureSetup();

    const experiment = new Experiment(name, options);
    await experiment.initialize();
    return experiment;
  }

  /**
   * Initialize the evaluation by creating/getting the experiment
   */
  private async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new ExperimentInitError(
        "API key is required. Set LANGWATCH_API_KEY or pass apiKey to LangWatch constructor.",
      );
    }

    try {
      const response = await fetch(`${this.endpoint}/api/experiment/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey: this.apiKey }),
        },
        body: JSON.stringify({
          experiment_name: this.name,
          experiment_slug: this.experimentSlug,
          experiment_type: "BATCH_EVALUATION_V2",
        }),
      });

      if (response.status === 401) {
        throw new ExperimentInitError("Invalid API key");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new ExperimentInitError(`Failed to initialize experiment: ${text}`);
      }

      const data = (await response.json()) as ExperimentInitResponse;
      (this as { experimentSlug: string }).experimentSlug = data.slug;

      const encodedRunId = encodeURIComponent(this.runId);
      this.runUrl = `${this.endpoint}${data.path}?runId=${encodedRunId}`;
      console.log(`Follow results at: ${this.runUrl}`);

      this.initialized = true;
    } catch (error) {
      if (error instanceof ExperimentInitError) {
        throw error;
      }
      throw new ExperimentInitError(
        `Failed to initialize evaluation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
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
    options?: RunOptions,
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const concurrency = options?.concurrency ?? this.concurrency;
    this.total = dataset.length;
    this.progress = 0;

    const tracer = trace.getTracer("langwatch");

    // Process items with concurrency control
    const executing = new Set<Promise<void>>();

    for (let index = 0; index < dataset.length; index++) {
      const item = dataset[index] as T;

      const itemPromise = this.executeItem(tracer, item, index, callback);

      executing.add(itemPromise);
      void itemPromise.finally(() => executing.delete(itemPromise));

      // Wait if we've hit concurrency limit
      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    // Wait for all remaining items
    await Promise.all(executing);

    // Flush OTEL spans so all child spans created inside callbacks are exported
    const provider = trace.getTracerProvider();
    const delegate =
      "getDelegate" in provider && typeof provider.getDelegate === "function"
        ? provider.getDelegate()
        : provider;
    if (
      delegate &&
      "forceFlush" in delegate &&
      typeof delegate.forceFlush === "function"
    ) {
      await delegate.forceFlush();
    }

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
    callback: RunCallback<T>,
  ): Promise<void> {
    const startTime = Date.now();
    let error: Error | undefined;
    let capturedTraceId: string | null = null;

    // Reset withTarget tracking for this iteration
    this.iterationUsedWithTarget.set(index, false);

    // Set up iteration context (thread-safe via AsyncLocalStorage)
    const iterationContext: IterationContext = { index, item, traceId: null };

    // If evaluation uses targets, skip creating iteration-level traces
    // Each withTarget() call will create its own independent trace
    if (this.evaluationUsesTargets) {
      await iterationContextStorage.run(iterationContext, async () => {
        try {
          // Create a minimal span context for the callback
          const span = {
            setStatus: () => {
              /* no-op */
            },
            recordException: () => {
              /* no-op */
            },
            end: () => {
              /* no-op */
            },
          } as unknown as LangWatchSpan;

          const ctx: RunContext<T> = { item, index, span };
          const result = callback(ctx);

          if (result && typeof result.then === "function") {
            await result;
          }
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err));
          this.logger.error(`Evaluation error at index ${index}:`, error);
        }
      });
    } else {
      await iterationContextStorage.run(iterationContext, async () => {
        await tracer.startActiveSpan(
          "evaluation.iteration",
          {
            attributes: {
              "langwatch.origin": "evaluation",
              "evaluation.run_id": this.runId,
              "evaluation.index": index,
            },
          },
          async (otelSpan) => {
            const span = createLangWatchSpan(otelSpan);
            const spanContext = otelSpan.spanContext();
            const traceId = spanContext.traceId;

            // The row's own trace, for the log/evaluate/compare calls made
            // inside it. It rides the iteration context rather than the
            // instance, so a row reads its own trace and never a neighbour's.
            iterationContext.traceId = traceId;
            capturedTraceId = traceId;

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
            }
          },
        );
      });
    }

    // Only add a dataset entry if withTarget() was NOT used
    // When withTarget() is used, it creates its own dataset entries per target
    if (!this.iterationUsedWithTarget.get(index)) {
      const duration = Date.now() - startTime;
      const entry: BatchEntry = {
        index,
        entry: this.serializeItem(item),
        duration,
        error: error?.message ?? null,
        trace_id: capturedTraceId ?? this.getTraceIdFromContext(),
      };

      this.batch.dataset.push(entry);
      this.cumulativeEntries.push({
        duration: entry.duration,
        error: entry.error,
        cost: entry.cost,
        target_id: entry.target_id,
      });
    }

    // Clean up
    this.iterationUsedWithTarget.delete(index);

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
   * If called inside a withTarget() block, the target and index are automatically
   * inferred from the context and don't need to be specified.
   *
   * @example
   * ```typescript
   * // Explicit target (outside withTarget)
   * evaluation.log('accuracy', { index, score: 0.95, target: 'gpt-4' });
   *
   * // Implicit target (inside withTarget)
   * await evaluation.withTarget('gpt-4', { model: 'openai/gpt-4' }, async () => {
   *   evaluation.log('accuracy', { score: 0.95 }); // target and index auto-inferred
   * });
   * ```
   */
  log(metric: string, options: LogOptions): void {
    // Get context from AsyncLocalStorage (if inside withTarget)
    const targetContext = targetContextStorage.getStore();

    const {
      data = {},
      score,
      passed,
      label,
      details,
      status = options.error ? "error" : "processed",
      duration,
      cost,
      error,
      // Use context values as defaults, allow explicit override
      target = targetContext?.targetId,
      metadata,
      index = targetContext?.index ?? options.index,
    } = options;

    // Register target if provided (explicit or from context)
    let targetId: string | undefined;
    if (target) {
      targetId = this.registerTarget(target, metadata);
    }

    // Use trace ID from the target, then the row being iterated, then OTEL context
    const traceId =
      targetContext?.traceId ??
      iterationContextStorage.getStore()?.traceId ??
      this.getTraceIdFromContext();

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

    this.pushEvaluation(result);
  }

  /**
   * Queue an evaluation result for the next batch
   */
  private pushEvaluation(result: EvaluationResult): void {
    this.batch.evaluations.push(result);
    this.cumulativeEvaluations.push({
      name: result.name,
      evaluator: result.evaluator,
      status: result.status,
      passed: result.passed,
      score: result.score,
      cost: result.cost,
      target_id: result.target_id,
    });
    this.scheduleSend();
  }

  /**
   * Run a built-in evaluator
   *
   * @param evaluatorSlug - The evaluator identifier (e.g., 'ragas/faithfulness')
   * @param options - Evaluator options including data and settings
   *
   * If called inside a withTarget() block, the target and index are automatically
   * inferred from the context and don't need to be specified.
   *
   * @example
   * ```typescript
   * // Inside withTarget() - target and index auto-inferred
   * await evaluation.withTarget('gpt-4', { model: 'openai/gpt-4' }, async () => {
   *   await evaluation.evaluate('ragas/faithfulness', {
   *     data: { input, output, contexts },
   *   });
   * });
   *
   * // Or explicit index/target
   * await evaluation.evaluate('ragas/faithfulness', {
   *   index,
   *   data: { input, output, contexts },
   *   target: 'gpt-4',
   * });
   * ```
   */
  async evaluate(evaluatorSlug: string, options: EvaluateOptions): Promise<void> {
    // Get context from AsyncLocalStorage (if inside withTarget)
    const targetContext = targetContextStorage.getStore();

    const {
      data,
      settings,
      name,
      asGuardrail = false,
      // Use context values as defaults, allow explicit override
      target = targetContext?.targetId,
      metadata,
      index = targetContext?.index ?? options.index,
    } = options;

    const startTime = Date.now();
    // Use trace ID from the target, then the row being iterated, then OTEL context
    const traceId =
      targetContext?.traceId ??
      iterationContextStorage.getStore()?.traceId ??
      this.getTraceIdFromContext();
    const spanId = targetContext?.spanId ?? this.getSpanIdFromContext();

    try {
      const result = await this.callEvaluator({
        evaluatorSlug,
        data,
        settings,
        name,
        traceId,
        spanId,
        asGuardrail,
      });
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
        error instanceof Error ? error : undefined,
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
   * Call an evaluator and return its raw result
   */
  private async callEvaluator({
    evaluatorSlug,
    data,
    settings,
    name,
    traceId,
    spanId,
    asGuardrail = false,
  }: {
    evaluatorSlug: string;
    data: Record<string, unknown>;
    settings?: Record<string, unknown>;
    name?: string;
    traceId?: string | null;
    spanId?: string | null;
    asGuardrail?: boolean;
  }): Promise<RunEvaluatorResponse> {
    const response = await fetch(
      `${this.endpoint}/api/evaluations/${evaluatorSlug}/evaluate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey: this.apiKey }),
        },
        body: JSON.stringify({
          trace_id: traceId ?? null,
          span_id: spanId ?? null,
          name: name ?? evaluatorSlug,
          data,
          settings,
          as_guardrail: asGuardrail,
        }),
        signal: AbortSignal.timeout(EVALUATOR_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new EvaluatorError(evaluatorSlug, text);
    }

    return (await response.json()) as RunEvaluatorResponse;
  }

  /**
   * Compare a row's targets and pick the best one
   *
   * Every target that recorded an output for the row is judged together in a
   * single call, and the winner comes back named with the target name you
   * registered. Call it once the row's withTarget() calls have all settled,
   * which under the usual Promise.all is right after the await.
   *
   * The verdict grades no single target, so it is recorded against the row.
   *
   * The row is named the way log() names it: inside a run() callback it is
   * inferred from the row being processed, and outside one it is required.
   *
   * A row with fewer than two outputs cannot be compared: it is recorded as
   * skipped, naming the targets that produced nothing, and the run carries on.
   * A judge that fails or cannot be reached comes back as an `error` verdict
   * for the same reason, and stays distinct from `inconclusive`, which is the
   * judge telling you something about your candidates. Naming a target that
   * produced no output is a different thing again, and throws, because a
   * two-way verdict read as the three-way one you asked for is worse than a
   * failure.
   *
   * @param options - How the judge should read the row, and which row when
   *                  it cannot be inferred
   * @returns The verdict, including the candidates it actually saw
   *
   * @example
   * ```typescript
   * await experiment.run(dataset, async ({ item }) => {
   *   await Promise.all([
   *     experiment.withTarget('gpt-5-mini', () => askGpt(item.question)),
   *     experiment.withTarget('claude-sonnet-5', () => askClaude(item.question)),
   *   ]);
   *
   *   const verdict = await experiment.compare({ input: item.question });
   *   console.log(verdict.winner);
   * });
   * ```
   */
  async compare(options: ComparisonOptions = {}): Promise<ComparisonVerdict> {
    const { name = DEFAULT_COMPARISON_NAME, targets, input, golden } = options;

    const index = this.resolveComparisonRow(options.index);

    const captured =
      this.capturedOutputs.get(index) ?? new Map<string, CapturedTargetOutput>();

    if (targets) {
      const missing = targets.filter((target) => !captured.has(target));
      if (missing.length > 0) {
        throw new ComparisonError(
          `Cannot compare row ${index}: no output was recorded for ${missing
            .map((target) => `'${target}'`)
            .join(", ")}. Compare a row once every withTarget() call for it has settled.`,
          missing,
        );
      }
    }

    // Registration order, not the order the outputs happened to land in:
    // targets usually run concurrently, so completion order varies per row and
    // would reshuffle what the judge sees from one row to the next.
    const requested = targets ? new Set(targets) : null;
    const candidates = Array.from(this.targets.keys()).filter(
      (target) => captured.has(target) && (requested === null || requested.has(target)),
    );

    if (candidates.length < 2) {
      const missing = Array.from(this.targets.keys()).filter(
        (target) =>
          !captured.has(target) && (requested === null || requested.has(target)),
      );
      const verdict: ComparisonVerdict = {
        status: "skipped",
        winner: null,
        reasoning: describeSkippedComparison({ candidates, missing }),
        candidates,
      };

      this.recordComparison({ name, index, verdict });

      return verdict;
    }

    const data = buildComparisonData({
      input,
      golden,
      candidates: buildComparisonCandidates(candidates, captured),
      index,
    });
    const settings = buildComparisonSettings(options);

    const startTime = Date.now();

    // A judge that could not be reached measured nothing about the
    // candidates, so it is an errored row rather than a finding about them.
    // One unreachable judge must not end a run over a thousand rows either,
    // so the failure is reported to the caller instead of thrown.
    let response: RunEvaluatorResponse;
    try {
      response = await this.callEvaluator({
        evaluatorSlug: COMPARISON_EVALUATOR_SLUG,
        data,
        settings,
        name,
        traceId:
          iterationContextStorage.getStore()?.traceId ?? this.getTraceIdFromContext(),
        spanId: this.getSpanIdFromContext(),
      });
    } catch (error) {
      response = {
        status: "error",
        details: error instanceof Error ? error.message : String(error),
      };
    }

    const verdict = toComparisonVerdict({ response, candidates });

    this.recordComparison({
      name,
      index,
      verdict,
      score: response.score ?? null,
      cost: response.cost?.amount ?? null,
      duration: Date.now() - startTime,
    });

    return verdict;
  }

  /**
   * The row a comparison is about
   *
   * Inferred from the row being processed, the same way withTarget() and
   * log() infer theirs, so a comparison inside a run() callback never repeats
   * an index the SDK already has. It reads that row from the iteration's own
   * context, which is what keeps a run of many rows at once from handing one
   * row's comparison the row a neighbour happens to be on.
   *
   * What it deliberately does not do is fall back to a row: judging row 0
   * because no row was named would hand back a confident verdict about
   * candidates the caller never asked about.
   */
  private resolveComparisonRow(index?: number): number {
    const resolved = index ?? iterationContextStorage.getStore()?.index;

    if (resolved === undefined) {
      throw new ComparisonError(
        "Cannot compare: no row was given and none could be inferred. Pass index explicitly when comparing outside a run() iteration.",
      );
    }

    return resolved;
  }

  /**
   * Record a comparison verdict against the row
   *
   * The verdict the caller is handed is the only input, so the row can never
   * say one thing while the return value says another.
   *
   * Deliberately not routed through log(): a comparison grades no single
   * target, so it must not pick one up from an ambient withTarget() context,
   * and it is recorded under the judge's own evaluator id so the results page
   * can tell it apart from a hand-logged metric.
   */
  private recordComparison({
    name,
    index,
    verdict,
    score = null,
    cost = null,
    duration = null,
  }: {
    name: string;
    index: number;
    verdict: ComparisonVerdict;
    score?: number | null;
    cost?: number | null;
    duration?: number | null;
  }): void {
    const status = comparisonEntryStatus(verdict.status);

    this.pushEvaluation({
      name,
      evaluator: COMPARISON_EVALUATOR_SLUG,
      trace_id:
        iterationContextStorage.getStore()?.traceId ?? this.getTraceIdFromContext(),
      status,
      // The results page keys a comparison column off this candidate list.
      data: {
        candidates: verdict.candidates.map((candidate) => ({ id: candidate })),
      },
      // A row that established nothing carries no score: 0.5 would read as the
      // tie it is not, and 1.0 as a win for a winner it does not have.
      score: status === "processed" ? score : null,
      passed: null,
      details: verdict.reasoning,
      index,
      label: comparisonEntryLabel(verdict),
      cost,
      duration,
      error_type: null,
      traceback: null,
      target_id: null,
    });
  }

  /**
   * Execute code within a target context with automatic tracing
   *
   * Creates a new span for this target execution and sets up context
   * so that log() calls inside the callback automatically use this target.
   * Duration and output are captured automatically.
   *
   * This creates a dataset entry per target (like Evaluations V3), enabling
   * proper per-target latency and cost tracking.
   *
   * @param targetName - Unique identifier for the target
   * @param metadata - Optional metadata for comparison (e.g., { model: 'gpt-4' })
   * @param callback - Function to execute within the target context
   * @returns The callback result along with captured metrics
   *
   * @example
   * ```typescript
   * await evaluation.run(dataset, async ({ item, index }) => {
   *   // Compare GPT-4 and Claude on the same input
   *   const [gpt4Result, claudeResult] = await Promise.all([
   *     evaluation.withTarget('gpt-4', { model: 'openai/gpt-4' }, async () => {
   *       const response = await openai.chat(item.question);
   *       evaluation.log('quality', { score: 0.95 }); // target auto-inferred
   *       return response;
   *     }),
   *     evaluation.withTarget('claude-3', { model: 'anthropic/claude-3' }, async () => {
   *       const response = await anthropic.messages(item.question);
   *       evaluation.log('quality', { score: 0.85 }); // target auto-inferred
   *       return response;
   *     }),
   *   ]);
   * });
   * ```
   */
  async withTarget<R>(
    targetName: string,
    metadata: TargetMetadata | null,
    callback: TargetCallback<R>,
  ): Promise<TargetResult<R>>;
  async withTarget<R>(
    targetName: string,
    callback: TargetCallback<R>,
  ): Promise<TargetResult<R>>;
  async withTarget<R>(
    targetName: string,
    metadataOrCallback: TargetMetadata | null | TargetCallback<R>,
    maybeCallback?: TargetCallback<R>,
  ): Promise<TargetResult<R>> {
    // Handle overloads
    const metadata = typeof metadataOrCallback === "function" ? null : metadataOrCallback;
    const callback =
      typeof metadataOrCallback === "function" ? metadataOrCallback : maybeCallback!;

    // On FIRST withTarget() call ever in this evaluation:
    // - Set flag to skip creating iteration-level traces going forward
    if (!this.evaluationUsesTargets) {
      this.evaluationUsesTargets = true;
    }

    // Get iteration context (thread-safe via AsyncLocalStorage)
    const iterationContext = iterationContextStorage.getStore();
    const index = iterationContext?.index ?? 0;
    const currentItem = iterationContext?.item;

    // Mark that withTarget() was used - prevents executeItem from creating a dataset entry
    this.iterationUsedWithTarget.set(index, true);

    // Register target
    this.registerTarget(targetName, metadata ?? undefined);

    const tracer = trace.getTracer("langwatch");
    const startTime = Date.now();
    let result: R | undefined;
    let traceId = "";
    let spanId = "";
    let callbackError: Error | undefined;

    // Create an INDEPENDENT root span using ROOT_CONTEXT
    // This ensures each target gets a unique trace_id, not shared with iteration
    await tracer.startActiveSpan(
      `evaluation.target.${targetName}`,
      {
        attributes: {
          "langwatch.origin": "evaluation",
          "evaluation.run_id": this.runId,
          "evaluation.target": targetName,
          "evaluation.index": index,
        },
      },
      ROOT_CONTEXT,
      async (otelSpan) => {
        const span = createLangWatchSpan(otelSpan);
        const spanContext = otelSpan.spanContext();
        const rawTraceId = spanContext.traceId;
        spanId = spanContext.spanId;

        // Check if this is a no-op trace (all zeros = no tracer configured)
        const isNoOpTrace = rawTraceId === "00000000000000000000000000000000";
        traceId = isNoOpTrace ? "" : rawTraceId;

        // Set up the target execution context
        const executionContext: TargetExecutionContext = {
          targetId: targetName,
          traceId,
          spanId,
          index,
        };

        try {
          // Run callback within AsyncLocalStorage context
          result = await targetContextStorage.run(executionContext, async () => {
            const ctx: TargetContext = { span, traceId, spanId };
            const callbackResult = callback(ctx);

            if (
              callbackResult &&
              typeof (callbackResult as Promise<R>).then === "function"
            ) {
              return await callbackResult;
            }
            return callbackResult as R;
          });

          span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
          callbackError = err instanceof Error ? err : new Error(String(err));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: callbackError.message,
          });
          span.recordException(callbackError);
          throw err;
        } finally {
          span.end();
        }
      },
    );

    const duration = Date.now() - startTime;

    // Serialize the result as "predicted" output (similar to Evaluations V3)
    let predicted: Record<string, unknown> | null = null;
    if (result !== undefined && result !== null) {
      predicted =
        typeof result === "object"
          ? (result as Record<string, unknown>)
          : { output: result };
    }

    // Create a dataset entry for this target execution (like Evaluations V3)
    // This captures per-target duration/latency properly
    // Use currentItem from iteration context (thread-safe), NOT shared instance variable
    const entry: BatchEntry = {
      index,
      entry: this.serializeItem(currentItem),
      duration,
      error: callbackError?.message ?? null,
      trace_id: traceId || null, // null if no tracer configured (no-op)
      target_id: targetName,
      predicted,
    };

    this.batch.dataset.push(entry);
    this.cumulativeEntries.push({
      duration: entry.duration,
      error: entry.error,
      cost: entry.cost,
      target_id: entry.target_id,
    });
    this.captureTargetOutput({
      index,
      targetName,
      output: renderTargetOutput(result),
      durationMs: duration,
    });
    this.scheduleSend();

    return {
      result: result!,
      duration,
      traceId,
      spanId,
    };
  }

  /**
   * Keep a target's output for the row so compare() can reach it later
   *
   * The batch this output also went into is flushed on a timer and cleared, so
   * a comparison that read its candidates from there would find them missing
   * whenever the flush landed first. A target that produced nothing is not
   * captured at all: it has no output to judge.
   */
  private captureTargetOutput({
    index,
    targetName,
    output,
    durationMs,
  }: {
    index: number;
    targetName: string;
    output: string;
    durationMs?: number;
  }): void {
    if (output === "") {
      return;
    }

    let row = this.capturedOutputs.get(index);
    if (!row) {
      row = new Map<string, CapturedTargetOutput>();
      this.capturedOutputs.set(index, row);
    }
    row.set(targetName, { output, durationMs });

    while (this.capturedOutputs.size > MAX_COMPARISON_ROWS_RETAINED) {
      const oldest = this.capturedOutputs.keys().next();
      if (oldest.done) break;
      this.capturedOutputs.delete(oldest.value);
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
    } else {
      this.flushTimeout ??= setTimeout(
        () => {
          this.flushTimeout = null;
          this.sendBatch();
        },
        DEBOUNCE_INTERVAL_MS - (now - this.lastSentMs),
      );
    }
  }

  /**
   * Print a CI-friendly summary and optionally exit with code 1 on failure.
   *
   * Mirrors `ExperimentRunResult.printSummary` for parity — SDK-driven experiments
   * can now fail CI builds the same way platform experiments do.
   *
   * @param exitOnFailure - If true (default), calls `process.exit(1)` when any evaluation failed.
   *
   * @example
   * ```typescript
   * const experiment = await langwatch.experiments.init("ci-quality-check");
   * await experiment.run(dataset, async ({ item, index }) => {
   *   const response = await myLLM(item.input);
   *   await experiment.evaluate("ragas/faithfulness", { index, data: { input: item.input, output: response } });
   * });
   * experiment.printSummary();
   * ```
   */
  printSummary(exitOnFailure = true): void {
    const evaluators = new Map<
      string,
      { passed: number; failed: number; scoreSum: number; scoreCount: number }
    >();
    let totalPassed = 0;
    let totalFailed = 0;
    let totalCost = 0;

    for (const e of this.cumulativeEvaluations) {
      const name = e.name ?? e.evaluator ?? "unknown";
      if (!evaluators.has(name)) {
        evaluators.set(name, { passed: 0, failed: 0, scoreSum: 0, scoreCount: 0 });
      }
      const stats = evaluators.get(name)!;
      // Evaluators that crashed come back as status:"error" with passed often null;
      // treat them as failures so CI doesn't silently succeed on evaluator crashes.
      if (e.status === "error" || e.passed === false) {
        stats.failed += 1;
        totalFailed += 1;
      } else if (e.passed === true) {
        stats.passed += 1;
        totalPassed += 1;
      }
      if (typeof e.score === "number") {
        stats.scoreSum += e.score;
        stats.scoreCount += 1;
      }
      if (typeof e.cost === "number") {
        totalCost += e.cost;
      }
    }

    const targets = new Map<
      string,
      {
        passed: number;
        failed: number;
        latencySum: number;
        latencyCount: number;
        cost: number;
      }
    >();
    for (const entry of this.cumulativeEntries) {
      const tid = entry.target_id;
      if (!tid) continue;
      if (!targets.has(tid)) {
        targets.set(tid, {
          passed: 0,
          failed: 0,
          latencySum: 0,
          latencyCount: 0,
          cost: 0,
        });
      }
      const stats = targets.get(tid)!;
      if (typeof entry.duration === "number") {
        stats.latencySum += entry.duration;
        stats.latencyCount += 1;
      }
      if (typeof entry.cost === "number") {
        stats.cost += entry.cost;
      }
    }
    // Lazily seed target stats from evaluations too — a user can log an
    // evaluation with an explicit target_id without ever going through
    // withTarget(), in which case the per-target entry row may not carry
    // target_id. Without this, such a target would be silently dropped from
    // the per-target summary.
    for (const e of this.cumulativeEvaluations) {
      const tid = e.target_id;
      if (!tid) continue;
      if (!targets.has(tid)) {
        targets.set(tid, {
          passed: 0,
          failed: 0,
          latencySum: 0,
          latencyCount: 0,
          cost: 0,
        });
      }
      const stats = targets.get(tid)!;
      if (e.status === "error" || e.passed === false) stats.failed += 1;
      else if (e.passed === true) stats.passed += 1;
      if (typeof e.cost === "number") stats.cost += e.cost;
    }

    const total = totalPassed + totalFailed;
    const passRate = total > 0 ? (totalPassed / total) * 100 : 0;

    // Wall-clock duration from init — summing entry durations over-counts
    // under concurrent withTarget() calls (each target produces its own entry).
    const duration = Math.max(0, Date.now() - this.createdAtMs);

    // Count entries whose target/loop execution errored out — distinct from
    // evaluator failures but must also trigger CI exit.
    let failedCells = 0;
    for (const entry of this.cumulativeEntries) {
      if (typeof entry.cost === "number") totalCost += entry.cost;
      if (entry.error) failedCells += 1;
    }

    const hasFailures = totalFailed > 0 || failedCells > 0;

    printSummary({
      runId: this.runId,
      status: hasFailures ? "failed" : "completed",
      passed: totalPassed,
      failed: totalFailed,
      passRate,
      duration,
      runUrl: this.runUrl,
      summary: {
        runId: this.runId,
        totalCells: this.cumulativeEntries.length || total,
        completedCells: Math.max(
          0,
          (this.cumulativeEntries.length || total) - failedCells,
        ),
        failedCells,
        duration,
        runUrl: this.runUrl,
        totalPassed,
        totalFailed,
        passRate,
        totalCost,
        targets: Array.from(targets.entries()).map(([targetId, s]) => ({
          targetId,
          name: targetId,
          passed: s.passed,
          failed: s.failed,
          avgLatency: s.latencyCount > 0 ? s.latencySum / s.latencyCount : 0,
          totalCost: s.cost,
        })),
        evaluators: Array.from(evaluators.entries()).map(([name, s]) => ({
          evaluatorId: name,
          name,
          passed: s.passed,
          failed: s.failed,
          passRate:
            s.passed + s.failed > 0 ? (s.passed / (s.passed + s.failed)) * 100 : 0,
          avgScore: s.scoreCount > 0 ? s.scoreSum / s.scoreCount : undefined,
        })),
      },
    });

    if (exitOnFailure && hasFailures) {
      process.exit(1);
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
        target_id: entry.target_id ?? null,
        cost: entry.cost ?? null,
        // Only include predicted if it's defined (omit entirely when null/undefined)
        ...(entry.predicted !== undefined && entry.predicted !== null
          ? { predicted: entry.predicted }
          : {}),
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
        ...buildAuthHeaders({ apiKey: this.apiKey }),
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
      if (
        "toJSON" in item &&
        typeof (item as { toJSON: unknown }).toJSON === "function"
      ) {
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
