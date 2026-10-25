import { convertTo } from "@langwatch/dataset-contract";
import {
  EvaluatorExecutionError,
  type EvaluatorRuntimeEngine,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  batchEvaluationResultSchema,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nlpInternalSecretHeaders } from "@langwatch/process/nlp-internal-secret";

import type {
  LangevalsChannel,
  LangevalsPayloadStaging,
} from "../../../channels/langevals.channel.ts";
import {
  engineForEvaluator,
  isSameVerdict,
} from "../../../rules/evaluator-runtime-engine.rules.ts";
import { toLangevalsContexts } from "../../../rules/langevals-contexts.rules.ts";
import type { EvaluationExecutionMetricsService } from "../../execution/services/evaluation-execution-metrics.service.ts";
import {
  type EvaluationTelemetry,
  isUnservedByRuntime,
  refusedCall,
  throwFetchFailure,
  TIMED_OUT_STATUS,
} from "./langevals-evaluator-failure.service.ts";

const logger = createLogger("langwatch:langevals-http-client");

/**
 * Where the Go evaluator runtime answers, which evaluators it answers, its bearer, and the
 * engine hop's shared secret that nlpgo asks on every /go route.
 */
export type EvaluatorRuntimeRouting = Readonly<{
  endpoint: string | undefined;
  engine: EvaluatorRuntimeEngine;
  engineOverrides: Readonly<Record<string, EvaluatorRuntimeEngine>>;
  internalSecret: string | undefined;
  nlpInternalSecret: string | undefined;
}>;

/**
 * What the transport needs from the deployment: where the evaluator service
 * lives, how long a call may take and how many times a 5xx other than a 504 is retried.
 * Absent `evaluatorRuntime` answers every evaluator from langevals.
 */
type LangevalsRuntimeConfig = Readonly<{
  endpoint: string | undefined;
  maxRetries: number;
  timeoutMs: number;
  evaluatorRuntime?: EvaluatorRuntimeRouting | undefined;
}>;

/** One call's destination: the URL, its headers and which engine answers. */
type EvaluatorTarget = Readonly<{
  engine: "python" | "go";
  url: string;
  headers: Readonly<Record<string, string>>;
  telemetry: EvaluationTelemetry | undefined;
}>;

interface LangevalsEvaluatorInput {
  readonly config: LangevalsRuntimeConfig;
  readonly langevals: LangevalsChannel;
  readonly staging: LangevalsPayloadStaging;
  readonly telemetry?: Pick<EvaluationExecutionMetricsService, "record"> | undefined;
}

/** Runs one installed evaluator over the langevals channel: retry, timeout and result mapping. */
export class LangevalsEvaluatorService {
  static create(input: LangevalsEvaluatorInput): LangevalsEvaluatorService {
    return new LangevalsEvaluatorService(input);
  }

  private readonly config: LangevalsRuntimeConfig;
  private readonly langevals: LangevalsChannel;
  private readonly staging: LangevalsPayloadStaging;
  private readonly telemetry: Pick<EvaluationExecutionMetricsService, "record"> | undefined;

  private constructor(input: LangevalsEvaluatorInput) {
    this.config = input.config;
    this.langevals = input.langevals;
    this.staging = input.staging;
    this.telemetry = input.telemetry;
  }

  async evaluate(params: LangevalsEvaluateParams): Promise<SingleEvaluationResult> {
    const routing = this.config.evaluatorRuntime;
    const engine = routing
      ? engineForEvaluator({
          evaluatorType: params.evaluatorType,
          engine: routing.engine,
          engineOverrides: routing.engineOverrides,
        })
      : "python";
    const retriesLeft = this.config.maxRetries;

    if (engine === "go") {
      try {
        return await this.evaluateWithRetry({ params, target: this.goTarget(params), retriesLeft });
      } catch (error) {
        // Go refuses what it does not serve (a valid_format mode short of parity): langevals
        // answers it.
        if (!isUnservedByRuntime(error)) throw error;
        if (!this.config.endpoint) {
          logger.error(
            { evaluatorType: params.evaluatorType },
            "Evaluator is routed to the Go runtime, which does not serve it",
          );
          throw error;
        }
        logger.warn(
          { evaluatorType: params.evaluatorType },
          "Go runtime does not serve this call; langevals answers it",
        );
        return this.evaluateWithRetry({ params, target: this.pythonTarget(params), retriesLeft });
      }
    }

    // As the null channel answers: a Go-only deployment composes a live channel.
    if (!this.config.endpoint)
      return { status: "skipped", details: "Langevals client not available" };

    const python = this.evaluateWithRetry({
      params,
      target: this.pythonTarget(params),
      retriesLeft,
    });
    if (engine === "shadow") void this.shadow({ params, python });
    return python;
  }

  private pythonTarget(params: LangevalsEvaluateParams): EvaluatorTarget {
    return {
      engine: "python",
      url: `${this.config.endpoint}/${params.evaluatorType}/evaluate`,
      headers: params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {},
      telemetry: this.telemetry,
    };
  }

  /** No `X-LangWatch-Trace-Token` yet: minting one is a pending decision. */
  private goTarget(params: LangevalsEvaluateParams): EvaluatorTarget {
    return {
      engine: "go",
      url: `${this.config.evaluatorRuntime?.endpoint}/${params.evaluatorType}/evaluate`,
      headers: {
        Authorization: `Bearer ${this.config.evaluatorRuntime?.internalSecret ?? ""}`,
        ...nlpInternalSecretHeaders({ secret: this.config.evaluatorRuntime?.nlpInternalSecret }),
        "X-LangWatch-Project-Id": params.projectId,
        ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
      },
      telemetry: this.telemetry,
    };
  }

  /**
   * Calls Go beside the Python answer and logs the pair: statuses, scores and whether the
   * verdicts agree, never entry text. No retry, no telemetry and no provider credentials;
   * the shadow header has Go admit it outside the project's live share.
   */
  private async shadow({
    params,
    python,
  }: {
    params: LangevalsEvaluateParams;
    python: Promise<SingleEvaluationResult>;
  }): Promise<void> {
    const live = this.goTarget(params);
    const target = {
      ...live,
      headers: { ...live.headers, "X-LangWatch-Shadow": "1" },
      telemetry: undefined,
    };
    const [pythonOutcome, goOutcome] = await Promise.allSettled([
      python,
      this.evaluateWithRetry({ params: { ...params, env: {} }, target, retriesLeft: 0 }),
    ]);
    const described = (outcome: PromiseSettledResult<SingleEvaluationResult>) =>
      outcome.status === "fulfilled"
        ? {
            status: outcome.value.status,
            score: outcome.value.status === "processed" ? outcome.value.score : undefined,
          }
        : {
            status: "failed",
            code: outcome.reason instanceof HandledError ? outcome.reason.code : "unhandled",
          };

    logger.info(
      {
        evaluatorType: params.evaluatorType,
        python: described(pythonOutcome),
        go: described(goOutcome),
        equal:
          pythonOutcome.status === "fulfilled" &&
          goOutcome.status === "fulfilled" &&
          isSameVerdict({ python: pythonOutcome.value, go: goOutcome.value }),
      },
      "evaluator runtime shadow comparison",
    );
  }

  private async evaluateWithRetry({
    params,
    target,
    retriesLeft,
  }: {
    params: LangevalsEvaluateParams;
    target: EvaluatorTarget;
    retriesLeft: number;
  }): Promise<SingleEvaluationResult> {
    const { evaluatorType, data, settings, env, signal } = params;
    const { url, telemetry } = target;
    const startTime = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.langevals.post({
        url,
        kind: "evaluation",
        staging: this.staging,
        headers: target.headers,
        signal: withCallerSignal({ own: controller.signal, caller: signal }),
        body: evaluationBody({ evaluatorType, data, settings, env }),
      });
    } catch (error) {
      throwFetchFailure({
        error,
        url,
        timeoutMs: this.config.timeoutMs,
        evaluatorType,
        onTooLarge: () =>
          telemetry?.record({
            evaluatorType,
            status: "skipped",
            durationMs: performance.now() - startTime,
          }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const transient = response.status >= 500 && response.status !== TIMED_OUT_STATUS;
      if (transient && retriesLeft > 0 && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.evaluateWithRetry({ params, target, retriesLeft: retriesLeft - 1 });
      }

      throw await refusedCall({
        response,
        engine: target.engine,
        evaluatorType,
        telemetry,
        durationMs: performance.now() - startTime,
      });
    }

    const duration = performance.now() - startTime;
    let results: BatchEvaluationResult;
    try {
      results = batchEvaluationResultSchema.parse(await response.json());
    } catch (error) {
      telemetry?.record({ evaluatorType, status: "error", durationMs: duration });
      throw new EvaluatorExecutionError("Unexpected response: invalid results", {
        meta: { evaluatorType },
        ...(error instanceof Error ? { reasons: [error] } : {}),
      });
    }

    const result = results[0];
    if (!result) {
      telemetry?.record({ evaluatorType, status: "error", durationMs: duration });
      throw new EvaluatorExecutionError("Unexpected response: empty results", {
        meta: { evaluatorType },
      });
    }

    telemetry?.record({ evaluatorType, status: result.status, durationMs: duration });
    return result;
  }
}

const CANONICAL_KEYS: ReadonlySet<string> = new Set([
  "input",
  "output",
  "contexts",
  "expected_contexts",
  "expected_output",
  "conversation",
]);

/** The non-canonical fields the evaluator declares (a comparison's `candidates`), as sent. */
function declaredExtras({
  evaluatorType,
  data,
}: Pick<LangevalsEvaluateParams, "evaluatorType" | "data">): Record<string, unknown> {
  const declared = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
  const allowed = new Set([
    ...(declared?.requiredFields ?? []),
    ...(declared?.optionalFields ?? []),
  ]);

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => allowed.has(key) && !CANONICAL_KEYS.has(key)),
  );
}

function evaluationBody({
  evaluatorType,
  data,
  settings,
  env,
}: Pick<LangevalsEvaluateParams, "evaluatorType" | "data" | "settings" | "env">) {
  return {
    data: [
      {
        ...declaredExtras({ evaluatorType, data }),
        input: convertTo(data.input, "string"),
        output: convertTo(data.output, "string"),
        contexts: toLangevalsContexts(data.contexts),
        expected_contexts: toLangevalsContexts(data.expected_contexts),
        expected_output: convertTo(data.expected_output, "string"),
        conversation: convertTo(data.conversation, "array"),
      },
    ],
    settings: settings ?? {},
    env,
  };
}

function withCallerSignal({
  own,
  caller,
}: {
  own: AbortSignal;
  caller: AbortSignal | undefined;
}): AbortSignal {
  return caller ? AbortSignal.any([own, caller]) : own;
}

export type LangevalsEvaluateParams = Readonly<{
  /** The tenant the Go evaluator runtime is told it evaluates for. */
  projectId: string;
  evaluatorType: string;
  data: Record<string, unknown>;
  settings: Record<string, unknown>;
  env: Record<string, string>;
  idempotencyKey?: string;
  /** The caller's cancellation, combined with this client's own timeout. */
  signal?: AbortSignal | undefined;
}>;
