/**
 * The shipped Instant Evals classifier: TypeSafe Jev.
 *
 * One POST per text, carrying every question about it. Measured against the
 * live API in September 2026: about 250 ms a call, 32k tokens of judged text
 * per request inside a 64k total, 255 options per category question, and input
 * tokens the only billed number.
 *
 * Three behaviours here are answers to things the API actually does, all
 * observed rather than assumed:
 *
 *  - **429 and 529 carry a `Retry-After` in seconds.** It replaces the backoff
 *    rather than adding to it, and it is capped: a five minute wait inside a
 *    synchronous query is a query that has already failed, so past the cap the
 *    row is skipped instead.
 *  - **A text past the state cap is a 400**, body
 *    `{"detail":{"error_type":"max_tokens_exceeded"}}`, not a 413 and not a
 *    422. It is retried once at three quarters of the length, because the
 *    estimate that sized it is bytes-over-four and a text dense in tokens can
 *    exceed the cap the estimate said it fit. A second refusal is a skip: a
 *    third cut would be guessing.
 *  - **Everything else in the 400s is permanent** — a bad key, an unknown
 *    model, a malformed question — so it is not retried, and it throws rather
 *    than skipping, because it would fail identically for every row.
 *
 * The key is LangWatch's own (`JEV_API_KEY`). A customer key is never sent
 * here and there is no code path that could.
 *
 * @see ./classifier.ts
 * @see ../../../../../specs/instant-evals/classifier.feature
 */

import { createLogger } from "@langwatch/observability";
import { type Dispatcher, Pool, fetch as undiciFetch } from "undici";

import { estimateTokensFromBytes } from "~/shared/traces/tokenBudget";
import { InstantEvalClassifierUnavailableError } from "../errors";
import {
  type InstantEvalClassifier,
  type InstantEvalClassifyRequest,
  type InstantEvalJudgement,
  instantEvalSkipped,
} from "./classifier";
import type { InstantEvalRateLimiter } from "./globalRateLimiter";
import { INSTANT_EVAL_PRICING } from "./pricing";
import {
  classifierResponseSchema,
  readClassifierVerdicts,
  toClassifierQuestions,
} from "./questions";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
  prepareInstantEvalText,
} from "./token-budget";

const logger = createLogger("langwatch:instant-evals:jev");

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai";
const JEV_PATH = "/v1/systemone";
/**
 * The model the API accepts, verified against it.
 *
 * `jev-latest` is a real name and resolves to a concrete version in the
 * response (`jev-1.13.0`, September 2026). A version written out, such as
 * `jev-1.13`, is refused with `Unknown model`, so this is not a placeholder to
 * be replaced with something more specific: `JEV_MODEL` is the way to pin one.
 */
const JEV_DEFAULT_MODEL = "jev-latest";

/** Attempts one text gets before it is given up on. */
const MAX_ATTEMPTS = 5;

/** Longest we will honour a `Retry-After` inside a synchronous query. */
const MAX_RETRY_AFTER_MS = 30_000;

/** Whole-request timeout, matching the reference client. */
const REQUEST_TIMEOUT_MS = 120_000;

/** How much of a text is kept when the classifier refuses it as too large. */
const TOO_LARGE_RETRY_FRACTION = 0.75;

/**
 * Connections the pool keeps to the classifier.
 *
 * At least the classifications one page keeps in flight, or the pool queues
 * behind itself before the limiter ever gets a say.
 */
const POOL_CONNECTIONS = 128;

export interface JevClassifierOptions {
  readonly apiKey: string;
  /** Origin only; the path is this client's own. */
  readonly baseUrl?: string;
  readonly model?: string;
  readonly limiter: InstantEvalRateLimiter;
  /** Injected by suites; a keep-alive pool to the classifier otherwise. */
  readonly dispatcher?: Dispatcher;
  /** Waits, and gives up waiting when the caller cancels. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** What one attempt came back as. */
type Attempt =
  | { readonly kind: "answered"; readonly judgement: InstantEvalJudgement }
  | {
      readonly kind: "retry";
      readonly waitMs: number;
      readonly isRateLimited: boolean;
    }
  | { readonly kind: "too_large" }
  | { readonly kind: "permanent"; readonly error: Error };

export class JevInstantEvalClassifier implements InstantEvalClassifier {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  private readonly endpoint: string;
  private readonly model: string;
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: JevClassifierOptions) {
    const baseUrl = options.baseUrl?.trim() ?? JEV_DEFAULT_BASE_URL;
    this.endpoint = new URL(JEV_PATH, baseUrl).toString();
    this.model = options.model?.trim() ?? JEV_DEFAULT_MODEL;
    this.ownsDispatcher = options.dispatcher === undefined;
    this.dispatcher =
      options.dispatcher ??
      new Pool(new URL(baseUrl).origin, {
        connections: POOL_CONNECTIONS,
        keepAliveTimeout: 30_000,
      });
    this.sleep = options.sleep ?? abortableSleep;
  }

  async close(): Promise<void> {
    if (this.ownsDispatcher) await this.dispatcher.close();
  }

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const budget = instantEvalTextBudget({
      questions: request.questions,
      limits: this.limits,
    });
    if (budget === null)
      return instantEvalSkipped("classifier_input_too_large");

    const prepared = prepareInstantEvalText({
      text: request.text,
      budgetTokens: budget,
    });
    return await this.attempt({
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
    const state: AttemptState = {
      text,
      isTruncated: isTextTruncated,
      isCutForSize: false,
    };

    // The questions cost the same on every attempt; the text may be cut
    // between them, so it is measured per send.
    const questionTokens = instantEvalQuestionTokens(request.questions);
    let limiterWaitMs = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const waitedFrom = Date.now();
      await this.options.limiter.acquire(
        {
          tokens: estimateTokensFromBytes(state.text) + questionTokens,
          tenantId: request.projectId,
        },
        signal,
      );
      limiterWaitMs += Date.now() - waitedFrom;
      const outcome = await this.send({
        text: state.text,
        request,
        isTruncated: state.isTruncated,
        ...(signal ? { signal } : {}),
      });

      const settled = settle({
        outcome,
        state,
        isLastAttempt: attempt === MAX_ATTEMPTS,
      });
      if (settled) return { ...settled, limiterWaitMs };
      if (outcome.kind === "retry") await this.sleep(outcome.waitMs, signal);
    }
    return { ...instantEvalSkipped("classifier_rate_limited"), limiterWaitMs };
  }

  /** One send, classified into an {@link Attempt}. */
  private async send({
    text,
    request,
    isTruncated,
    signal,
  }: {
    text: string;
    request: InstantEvalClassifyRequest;
    isTruncated: boolean;
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
      // A transport failure is worth another try: the reference client retries
      // these on the same backoff as a 5xx, and one dropped socket in a
      // thousand-row query should not cost that row its answer.
      return { kind: "retry", waitMs: backoffMs(1), isRateLimited: false };
    }

    if (response.status === 200) {
      return await this.readAnswer({ response, request, isTruncated });
    }
    return await classifyFailure({ response });
  }

  private async readAnswer({
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
        error: new Error(
          "the classifier answered with a body that is not its published shape",
        ),
      };
    }
    return {
      kind: "answered",
      judgement: {
        verdicts: readClassifierVerdicts({
          questions: request.questions,
          response: parsed.data,
        }),
        inputTokens: parsed.data.usage?.input_tokens ?? 0,
        isTextTruncated: isTruncated,
      },
    };
  }
}

/** What one text has become across the attempts so far. */
interface AttemptState {
  text: string;
  isTruncated: boolean;
  /** Whether the too-large retry has already spent its one cut. */
  isCutForSize: boolean;
}

/**
 * The judgement this attempt settles on, or `null` to try again.
 *
 * Throws only for a permanent refusal, which would fail identically for every
 * row and so is the caller's problem rather than this row's.
 */
function settle({
  outcome,
  state,
  isLastAttempt,
}: {
  outcome: Attempt;
  state: AttemptState;
  isLastAttempt: boolean;
}): InstantEvalJudgement | null {
  if (outcome.kind === "answered") return outcome.judgement;
  if (outcome.kind === "permanent") {
    throw new InstantEvalClassifierUnavailableError({
      reasons: [outcome.error],
    });
  }
  if (outcome.kind === "too_large") {
    // On the last attempt there is no send left to cut for, and reporting it
    // as rate limited would name the wrong cause entirely.
    return isLastAttempt
      ? instantEvalSkipped("classifier_input_too_large")
      : cutForRetry(state);
  }
  return isLastAttempt
    ? instantEvalSkipped(
        outcome.isRateLimited ? "classifier_rate_limited" : "classifier_failed",
      )
    : null;
}

/**
 * Cuts the text once so it can be sent again, or gives up on it.
 *
 * One cut, not a search: the estimate that sized it is bytes over four, so a
 * single miss is expected and a second is a text this request cannot carry.
 */
function cutForRetry(state: AttemptState): InstantEvalJudgement | null {
  if (state.isCutForSize) {
    return instantEvalSkipped("classifier_input_too_large");
  }
  state.isCutForSize = true;
  state.isTruncated = true;
  state.text = state.text.slice(
    0,
    Math.floor(state.text.length * TOO_LARGE_RETRY_FRACTION),
  );
  return null;
}

/** Reads one non-200 into an outcome. */
async function classifyFailure({
  response,
}: {
  response: Awaited<ReturnType<typeof undiciFetch>>;
}): Promise<Attempt> {
  const body = await response.text().catch(() => "");
  const { status } = response;

  if (status === 400 && body.includes("max_tokens_exceeded")) {
    return { kind: "too_large" };
  }
  if (status === 429 || status === 529 || status >= 500) {
    const waitMs = retryAfterMs(response.headers.get("retry-after"));
    const isRateLimited = status === 429 || status === 529;
    if (waitMs !== null && waitMs > MAX_RETRY_AFTER_MS) {
      logger.warn(
        { status, waitMs },
        "Instant Evals classifier asked for a wait past the cap; waiting the cap",
      );
    }
    return {
      kind: "retry",
      waitMs: Math.min(waitMs ?? backoffMs(1), MAX_RETRY_AFTER_MS),
      isRateLimited,
    };
  }
  return {
    kind: "permanent",
    error: new Error(`the classifier refused the request with ${status}`),
  };
}

/** `Retry-After` in milliseconds, or `null` when it is absent or not a number. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** Flat 1s base, which the caller caps. Kept simple: the API names its own waits. */
function backoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
}

/**
 * Waits, and stops waiting when the caller cancels.
 *
 * A plain `setTimeout` would hold a cancelled query for the whole
 * `Retry-After`, up to the thirty-second cap, after nobody was listening.
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
