/**
 * An own decision model over HTTP: one POST per text with the organization's key, to the fixed
 * endpoint the catalogue names (ADR-182 decisions 8 and 9). The provider's own error text is
 * never read into a result or a log; only the status is.
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  instantEvalSkipped,
  instantEvalTextBudget,
  readClassifierVerdicts,
  type InstantEvalJudgement,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import { type Dispatcher, fetch as undiciFetch } from "undici";

import { prepareInstantEvalText } from "../../rules/instant-eval-classifier-text.rules.ts";
import {
  decisionFailureOf,
  decisionRequestBodyOf,
  parseDecisionResponse,
} from "../../rules/instant-eval-decision-wire.rules.ts";
import type {
  InstantEvalDecisionModelChannel,
  InstantEvalDecisionModelRequest,
} from "../instant-eval-decision-model.channel.ts";

const logger = createLogger("langwatch:instant-evals:decision-model");

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export class HttpInstantEvalDecisionModelChannel implements InstantEvalDecisionModelChannel {
  private constructor(
    private readonly dispatcher: Dispatcher | undefined,
    private readonly sleep: Sleep,
  ) {}

  /** `dispatcher` is a suite's stand-in for the socket; undici's global pool otherwise. */
  static create({
    dispatcher,
    sleep = abortableSleep,
  }: { dispatcher?: Dispatcher; sleep?: Sleep } = {}): HttpInstantEvalDecisionModelChannel {
    return new HttpInstantEvalDecisionModelChannel(dispatcher, sleep);
  }

  async classify(
    { text, questions, decisionModel }: InstantEvalDecisionModelRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
    const budgetTokens = instantEvalTextBudget({ questions, limits });
    if (budgetTokens === 0) return instantEvalSkipped("classifier_input_too_large");
    const prepared = prepareInstantEvalText({ text, budgetTokens, limits });
    const body = JSON.stringify(
      decisionRequestBodyOf({
        wire: decisionModel.wire,
        providerModel: decisionModel.providerModel,
        text: prepared.text,
        questions,
      }),
    );

    let lastReason: InstantEvalSkipReason = "classifier_provider_unavailable";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const sent = await this.send({
        endpoint: decisionModel.endpoint,
        apiKey: decisionModel.apiKey,
        body,
        signal,
      });
      if (sent.kind === "answered") {
        const response = parseDecisionResponse({ wire: decisionModel.wire, body: sent.body });
        if (!response)
          return this.skip({
            reason: "classifier_provider_unavailable",
            model: decisionModel.model,
          });
        // The provider bills the organization, so nothing here is billed by LangWatch (ADR-182).
        return {
          verdicts: readClassifierVerdicts({ questions, response }),
          inputTokens: 0,
          isTextTruncated: prepared.isTruncated,
        };
      }
      if (sent.kind === "failed" && sent.failure.kind === "final") {
        return this.skip({
          reason: sent.failure.reason,
          model: decisionModel.model,
          status: sent.status,
        });
      }
      lastReason = sent.kind === "failed" ? sent.failure.reason : "classifier_provider_unavailable";
      if (attempt < MAX_ATTEMPTS)
        await this.sleep(waitMs({ attempt, retryAfter: sent.retryAfter }), signal);
    }
    return this.skip({ reason: lastReason, model: decisionModel.model });
  }

  private async send({
    endpoint,
    apiKey,
    body,
    signal,
  }: {
    endpoint: string;
    apiKey: string;
    body: string;
    signal: AbortSignal | undefined;
  }): Promise<
    | Readonly<{ kind: "answered"; body: unknown }>
    | Readonly<{
        kind: "failed";
        status: number;
        failure: ReturnType<typeof decisionFailureOf>;
        retryAfter: string | null;
      }>
    | Readonly<{ kind: "unreachable"; retryAfter: null }>
  > {
    try {
      const response = await undiciFetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body,
        signal: requestSignal(signal),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
      if (response.status === 200) {
        const parsed: unknown = await response.json().catch(() => undefined);
        return { kind: "answered", body: parsed };
      }
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: "failed",
        status: response.status,
        failure: decisionFailureOf({ status: response.status }),
        retryAfter: response.headers.get("retry-after"),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { kind: "unreachable", retryAfter: null };
    }
  }

  private skip({
    reason,
    model,
    status,
  }: {
    reason: InstantEvalSkipReason;
    model: string;
    status?: number;
  }): InstantEvalJudgement {
    logger.warn({ model, reason, status }, "Own decision model call did not answer");
    return instantEvalSkipped(reason);
  }
}

function waitMs({ attempt, retryAfter }: { attempt: number; retryAfter: string | null }): number {
  const seconds = retryAfter === null ? Number.NaN : Number.parseFloat(retryAfter);
  const fallback = 1_000 * 2 ** (attempt - 1);
  return Math.min(
    Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallback,
    MAX_WAIT_MS,
  );
}

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

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
