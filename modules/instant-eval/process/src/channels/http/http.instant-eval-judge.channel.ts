/**
 * The shipped judge: one POST per text, with LangWatch's own key — a customer
 * key is never sent here. @see specs/instant-evals/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  InstantEvalClassifierUnavailableError,
  type InstantEvalJudgement,
  instantEvalSkipped,
} from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { cutToEstimatedTokensKeepingEnds } from "@langwatch/trace-contract";
import { type Dispatcher, Pool, fetch as undiciFetch } from "undici";

import {
  classifierResponseSchema,
  readClassifierVerdicts,
  toClassifierQuestions,
} from "../../rules/instant-eval-judge-wire.rules.ts";
import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import {
  estimateJudgedTextTokens,
  estimateTokensFromBytes,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
  prepareInstantEvalText,
} from "../../rules/instant-eval-token-budget.rules.ts";
import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
  InstantEvalRateLimiterChannel,
} from "../instant-eval-judge.channel.ts";

const logger = createLogger("langwatch:instant-evals:jev");

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai";
const JEV_PATH = "/v1/systemone";

/**
 * `jev-latest` resolves to a concrete version in the response; a version
 * written out is refused as an unknown model, so this is not a placeholder.
 */
const JEV_DEFAULT_MODEL = "jev-latest";

/** Attempts one text gets before it is given up on. */
const MAX_ATTEMPTS = 5;

/** Longest we will honour a `Retry-After` inside a synchronous query. */
const MAX_RETRY_AFTER_MS = 30_000;

const REQUEST_TIMEOUT_MS = 120_000;

/** How much of a text is kept when the judge refuses it as too large. */
const TOO_LARGE_RETRY_FRACTION = 0.75;

/** At least the classifications one page keeps in flight. */
const POOL_CONNECTIONS = 128;

export interface HttpInstantEvalJudgeOptions {
  readonly apiKey: string;
  /** Origin only; the path is this channel's own. */
  readonly baseUrl?: string;
  readonly model?: string;
  readonly limiter: InstantEvalRateLimiterChannel;
  /** Injected by suites; a keep-alive pool to the judge otherwise. */
  readonly dispatcher?: Dispatcher;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** What one attempt came back as. */
type Attempt =
  | { readonly kind: "answered"; readonly judgement: InstantEvalJudgement }
  | { readonly kind: "retry"; readonly waitMs: number; readonly isRateLimited: boolean }
  | { readonly kind: "too_large" }
  | { readonly kind: "permanent"; readonly error: Error };

export class HttpInstantEvalJudgeChannel implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  private readonly endpoint: string;
  private readonly model: string;
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  private constructor(private readonly options: HttpInstantEvalJudgeOptions) {
    const baseUrl = options.baseUrl?.trim() ?? JEV_DEFAULT_BASE_URL;
    this.endpoint = new URL(JEV_PATH, baseUrl).toString();
    this.model = options.model?.trim() ?? JEV_DEFAULT_MODEL;
    this.ownsDispatcher = options.dispatcher === undefined;
    this.dispatcher =
      options.dispatcher ??
      new Pool(new URL(baseUrl).origin, {
        connections: POOL_CONNECTIONS,
        keepAliveTimeout: 30_000,
        // HTTP/1.1 on purpose: a cancelled page aborts every classification at
        // once, and that many stream resets on one HTTP/2 session left Node's
        // writer spinning until the process stopped answering.
        allowH2: false,
      });
    this.sleep = options.sleep ?? abortableSleep;
  }

  static create(options: HttpInstantEvalJudgeOptions): HttpInstantEvalJudgeChannel {
    return new HttpInstantEvalJudgeChannel(options);
  }

  async close(): Promise<void> {
    if (this.ownsDispatcher) await this.dispatcher.close();
  }

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const budget = instantEvalTextBudget({ questions: request.questions, limits: this.limits });
    if (budget === 0) return instantEvalSkipped("classifier_input_too_large");

    const prepared = prepareInstantEvalText({ text: request.text, budgetTokens: budget });
    return this.attempt({
      request,
      text: prepared.text,
      isTextTruncated: prepared.isTruncated,
      ...(signal ? { signal } : {}),
    });
  }

  /** The retry loop: one text, up to {@link MAX_ATTEMPTS} sends. */
  private async attempt({
    request,
    text,
    isTextTruncated,
    signal,
  }: {
    request: InstantEvalClassifyRequest;
    text: string;
    isTextTruncated: boolean;
    signal?: AbortSignal;
  }): Promise<InstantEvalJudgement> {
    const state: AttemptState = { text, isTruncated: isTextTruncated, isCutForSize: false };

    // The questions cost the same on every attempt; the text may be cut
    // between them, so it is measured per send, with the judge's own ratio.
    const questionTokens = instantEvalQuestionTokens(request.questions);
    let limiterWaitMs = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const waitedFrom = nowInstant().epochMilliseconds;
      await this.options.limiter.acquire(
        {
          tokens:
            estimateJudgedTextTokens({ text: state.text, limits: this.limits }) + questionTokens,
          tenantId: request.projectId,
        },
        signal,
      );
      limiterWaitMs += nowInstant().epochMilliseconds - waitedFrom;
      const outcome = await this.send({
        text: state.text,
        request,
        isTruncated: state.isTruncated,
        attempt,
        ...(signal ? { signal } : {}),
      });

      const settled = settle({ outcome, state, isLastAttempt: attempt === MAX_ATTEMPTS });
      if (settled.kind === "settled") return { ...settled.judgement, limiterWaitMs };
      if (outcome.kind === "retry") await this.sleep(outcome.waitMs, signal);
    }
    return { ...instantEvalSkipped("classifier_rate_limited"), limiterWaitMs };
  }

  /**
   * One send, classified into an {@link Attempt}. `attempt` sizes the backoff
   * when the API names no wait of its own.
   */
  private async send({
    text,
    request,
    isTruncated,
    attempt,
    signal,
  }: {
    text: string;
    request: InstantEvalClassifyRequest;
    isTruncated: boolean;
    attempt: number;
    signal?: AbortSignal;
  }): Promise<Attempt> {
    const body = JSON.stringify({
      state: text,
      model: this.model,
      questions: toClassifierQuestions(request.questions),
    });

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body,
        dispatcher: this.dispatcher,
        signal: requestSignal(signal),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // A transport failure is worth another try: one dropped socket in a
      // thousand-row query should not cost that row its answer.
      return { kind: "retry", waitMs: backoffMs(attempt), isRateLimited: false };
    }

    if (response.status === 200) {
      return readAnswer({ response, request, isTruncated });
    }
    return classifyFailure({ response, attempt });
  }
}

async function readAnswer({
  response,
  request,
  isTruncated,
}: {
  response: Awaited<ReturnType<typeof undiciFetch>>;
  request: InstantEvalClassifyRequest;
  isTruncated: boolean;
}): Promise<Attempt> {
  const parsed = classifierResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    return {
      kind: "permanent",
      error: new Error("the judge answered with a body that is not its published shape"),
    };
  }
  return {
    kind: "answered",
    judgement: {
      verdicts: readClassifierVerdicts({ questions: request.questions, response: parsed.data }),
      inputTokens: parsed.data.usage?.input_tokens ?? 0,
      isTextTruncated: isTruncated,
    },
  };
}

/** What one text has become across the attempts so far. */
interface AttemptState {
  text: string;
  isTruncated: boolean;
  /** Whether the too-large retry has already spent its one cut. */
  isCutForSize: boolean;
}

/** Whether this attempt settled the text, or the loop goes round again. */
type Settlement =
  | { readonly kind: "settled"; readonly judgement: InstantEvalJudgement }
  | { readonly kind: "retry" };

/**
 * What this attempt settles on. Throws only for a permanent refusal, which
 * would fail identically for every row.
 */
function settle({
  outcome,
  state,
  isLastAttempt,
}: {
  outcome: Attempt;
  state: AttemptState;
  isLastAttempt: boolean;
}): Settlement {
  if (outcome.kind === "answered") return settled(outcome.judgement);
  if (outcome.kind === "permanent") {
    throw new InstantEvalClassifierUnavailableError({ reasons: [outcome.error] });
  }
  if (outcome.kind === "too_large") {
    // On the last attempt there is no send left to cut for, and reporting it
    // as rate limited would name the wrong cause entirely.
    return isLastAttempt
      ? settled(instantEvalSkipped("classifier_input_too_large"))
      : cutForRetry(state);
  }
  return isLastAttempt
    ? settled(
        instantEvalSkipped(outcome.isRateLimited ? "classifier_rate_limited" : "classifier_failed"),
      )
    : { kind: "retry" };
}

function settled(judgement: InstantEvalJudgement): Settlement {
  return { kind: "settled", judgement };
}

/**
 * Cuts the text once so it can be sent again, or gives up: one miss is
 * expected of a bytes-over-four estimate, a second is a text too large.
 */
function cutForRetry(state: AttemptState): Settlement {
  if (state.isCutForSize) return settled(instantEvalSkipped("classifier_input_too_large"));
  state.isCutForSize = true;
  state.isTruncated = true;
  state.text = cutToEstimatedTokensKeepingEnds({
    text: state.text,
    maxTokens: Math.floor(estimateTokensFromBytes(state.text) * TOO_LARGE_RETRY_FRACTION),
  });
  return { kind: "retry" };
}

/** Reads one non-200 into an outcome. */
async function classifyFailure({
  response,
  attempt,
}: {
  response: Awaited<ReturnType<typeof undiciFetch>>;
  attempt: number;
}): Promise<Attempt> {
  const body = await response.text().catch(() => "");
  const { status } = response;

  if (status === 400 && body.includes("max_tokens_exceeded")) return { kind: "too_large" };
  if (status === 429 || status === 529 || status >= 500) {
    const waitMs = retryAfterMsOr({
      header: response.headers.get("retry-after"),
      fallback: backoffMs(attempt),
    });
    const isRateLimited = status === 429 || status === 529;
    if (waitMs > MAX_RETRY_AFTER_MS) {
      logger.warn(
        { status, waitMs },
        "Instant Evals judge asked for a wait past the cap; waiting the cap",
      );
    }
    return { kind: "retry", waitMs: Math.min(waitMs, MAX_RETRY_AFTER_MS), isRateLimited };
  }
  return {
    kind: "permanent",
    error: new Error(`the judge refused the request with ${status}`),
  };
}

/** `Retry-After` in milliseconds, or the backoff when it names no wait. */
function retryAfterMsOr({ header, fallback }: { header: string | null; fallback: number }): number {
  if (!header) return fallback;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallback;
}

/** 1s, 2s, 4s, 8s: doubles per attempt, capped, when the API names no wait. */
function backoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
}

/**
 * Waits, and stops waiting when the caller cancels: a plain `setTimeout` would
 * hold a cancelled query for the whole `Retry-After` after nobody was
 * listening.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The caller's cancellation and our own timeout, together. */
function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
