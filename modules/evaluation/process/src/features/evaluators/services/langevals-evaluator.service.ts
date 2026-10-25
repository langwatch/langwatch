import { convertTo } from "@langwatch/dataset-contract";
import {
  EvaluationBusyError,
  EvaluatorExecutionError,
  EvaluatorInputTooLargeError,
  EvaluatorNotFoundError,
  type EvaluatorRuntimeEngine,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  batchEvaluationResultSchema,
  type BatchEvaluationResult,
  type EvaluatorTypes,
  findEvaluatorDefinitions,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import { EvaluatorConfigError } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { nlpInternalSecretHeaders } from "@langwatch/process/nlp-internal-secret";
import { z } from "zod";

import {
  type LangevalsChannel,
  type LangevalsPayloadStaging,
  PayloadTooLargeError,
} from "../../../channels/langevals.channel.ts";
import {
  engineForEvaluator,
  handledCodeForRuntimeRefusal,
  isSameVerdict,
} from "../../../rules/evaluator-runtime-engine.rules.ts";
import { toLangevalsContexts } from "../../../rules/langevals-contexts.rules.ts";
import type { EvaluationExecutionMetricsService } from "../../execution/services/evaluation-execution-metrics.service.ts";

const logger = createLogger("langwatch:langevals-http-client");

/** LangEvals not up yet (still booting, or restarting): the queue retries the evaluation. */
const NOT_UP_YET = { httpStatus: 503, retryable: true } as const;
/** What a synchronous caller is told to wait (`Retry-After`) before asking again. */
const NOT_UP_YET_RETRY_AFTER_MS = 5_000;
/** The evaluator service, or the gateway in front of it, gave up waiting: never retried. */
const TIMED_OUT_STATUS = 504;

function throwFetchFailure({
  error,
  url,
  timeoutMs,
  evaluatorType,
  onTooLarge,
}: {
  error: unknown;
  url: string;
  timeoutMs: number;
  evaluatorType: string;
  onTooLarge: () => void;
}): never {
  if (error instanceof PayloadTooLargeError) {
    onTooLarge();
    throw new EvaluatorInputTooLargeError({ meta: { evaluatorType } });
  }

  if (error instanceof Error && error.name === "AbortError") {
    logger.warn({ url, timeoutMs }, "Evaluator request timed out");
    // The address dialled stays in the log line above: `meta` rides the
    // experiment SSE stream to the browser, and it is a deployment's own
    // internal service address.
    throw new EvaluatorExecutionError(`Evaluator timed out after ${timeoutMs}ms`, {
      meta: { evaluatorType, timeoutMs },
    });
  }

  if (error instanceof Error && error.message.includes("fetch failed")) {
    logger.warn({ error, url }, "Evaluator cannot be reached");
    throw new EvaluatorExecutionError("Evaluator cannot be reached", {
      meta: { evaluatorType, retryAfterMs: NOT_UP_YET_RETRY_AFTER_MS },
      ...NOT_UP_YET,
    });
  }

  throw error;
}

/** A built-in the Go runtime answered `evaluator_not_found` for, as `runtimeRefusal` builds it. */
function isUnservedByRuntime(error: unknown): boolean {
  return (
    error instanceof EvaluatorExecutionError && error.meta?.runtimeCode === "evaluator_not_found"
  );
}

type EvaluationTelemetry = Pick<EvaluationExecutionMetricsService, "record">;

/** herr's body, as the Go evaluator runtime refuses a call. */
const runtimeRefusalSchema = z.object({
  error: z.object({
    code: z.string(),
    meta: z.object({ retryAfterMs: z.number().optional() }).loose().optional(),
  }),
});

/** The handled error a Go runtime refusal becomes, recorded and logged without its body. */
async function runtimeRefusal({
  response,
  evaluatorType,
  telemetry,
  durationMs,
}: {
  response: Response;
  evaluatorType: string;
  telemetry: EvaluationTelemetry | undefined;
  durationMs: number;
}): Promise<Error> {
  const refusal = runtimeRefusalSchema.safeParse(await response.json().catch(() => undefined));
  const code = refusal.success ? refusal.data.error.code : undefined;
  const retryAfterMs = refusal.success ? refusal.data.error.meta?.retryAfterMs : undefined;
  const handledCode = handledCodeForRuntimeRefusal({ code });
  logger.warn(
    { evaluatorType, httpStatus: response.status, code },
    "Evaluator runtime refused the call",
  );
  telemetry?.record({
    evaluatorType,
    status: handledCode === "evaluator_input_too_large" ? "skipped" : "error",
    durationMs,
  });

  switch (handledCode) {
    case "evaluator_not_found":
      if (findEvaluatorDefinitions(evaluatorType).length === 0) {
        return new EvaluatorNotFoundError(evaluatorType);
      }
      // A built-in routed to Go before Go ports it is our routing fault, never a customer skip.
      return new EvaluatorExecutionError("The evaluator runtime does not serve this evaluator", {
        meta: { evaluatorType, runtimeCode: "evaluator_not_found" },
      });
    case "evaluator_config_error":
      return new EvaluatorConfigError("The evaluator's settings were refused", {
        meta: { evaluatorType },
      });
    case "evaluator_input_too_large":
      return new EvaluatorInputTooLargeError({ meta: { evaluatorType } });
    case "evaluation_busy":
      return new EvaluationBusyError({ evaluatorType, retryAfterMs });
    case "evaluator_execution_error":
      return new EvaluatorExecutionError("The evaluator runtime refused the call", {
        meta: {
          evaluatorType,
          runtimeCode: code ?? "unknown",
          ...(response.status === 503 ? { retryAfterMs: NOT_UP_YET_RETRY_AFTER_MS } : {}),
        },
        ...(response.status === 503 ? NOT_UP_YET : {}),
      });
  }
}

/** The error a non-retried refusal becomes: Go's herr code, or langevals' status and body. */
async function refusedCall({
  response,
  engine,
  evaluatorType,
  telemetry,
  durationMs,
}: {
  response: Response;
  engine: "python" | "go";
  evaluatorType: string;
  telemetry: EvaluationTelemetry | undefined;
  durationMs: number;
}): Promise<Error> {
  if (engine === "go") return runtimeRefusal({ response, evaluatorType, telemetry, durationMs });

  let statusText = response.statusText;
  try {
    statusText = JSON.stringify(await response.json(), undefined, 2);
  } catch {
    // The status text remains the meaningful response summary.
  }

  if (response.status === 413) {
    telemetry?.record({ evaluatorType, status: "skipped", durationMs });
    return new EvaluatorInputTooLargeError({
      meta: { evaluatorType, httpStatus: response.status },
    });
  }

  telemetry?.record({ evaluatorType, status: "error", durationMs });
  const timedOut = response.status === TIMED_OUT_STATUS ? "Evaluator timed out: " : "";
  return new EvaluatorExecutionError(`${timedOut}${response.status} ${statusText}`, {
    meta: {
      evaluatorType,
      httpStatus: response.status,
      ...(response.status === 503 ? { retryAfterMs: NOT_UP_YET_RETRY_AFTER_MS } : {}),
    },
    ...(response.status === 503 ? NOT_UP_YET : {}),
  });
}

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
