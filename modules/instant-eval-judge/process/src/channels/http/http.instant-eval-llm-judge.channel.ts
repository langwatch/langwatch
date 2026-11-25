/**
 * The router's LLM legs over HTTP, on LangWatch's keys: one forced tool call per question of any
 * kind, no retry (the router decides what a failure means). Only the status is read from a refusal.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { InstantEvalSkipReason } from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { type Dispatcher, fetch as undiciFetch } from "undici";

import { prepareInstantEvalText } from "../../rules/instant-eval-classifier-text.rules.ts";
import { decisionFailureOf } from "../../rules/instant-eval-decision-wire.rules.ts";
import {
  instantEvalLlmJudgeBodyOf,
  instantEvalLlmJudgePromptOf,
  readInstantEvalLlmJudgeAnswer,
  type InstantEvalLlmJudgeWire,
} from "../../rules/instant-eval-llm-judge-wire.rules.ts";
import {
  instantEvalLlmToolCallBodyOf,
  readInstantEvalLlmToolCall,
} from "../../rules/instant-eval-llm-tool-call-wire.rules.ts";
import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeChannel,
  InstantEvalLlmJudgeRequest,
  InstantEvalLlmToolCallAnswer,
  InstantEvalLlmToolCallRequest,
} from "../instant-eval-llm-judge.channel.ts";

const defaultLogger: Logger = createLogger("langwatch:instant-evals:llm-judge");

/** The one level the leg logs at, injected so a test can read what a failure was named. */
type InstantEvalLlmJudgeLogger = Pick<Logger, "warn">;

const ENDPOINTS: Record<InstantEvalLlmJudgeWire, string> = {
  anthropic_messages: "https://api.anthropic.com/v1/messages",
  openai_responses: "https://api.openai.com/v1/responses",
};

const ANTHROPIC_VERSION = "2023-06-01";

/** Content an LLM leg keeps, as langevals' judge fit does. */
const LLM_CONTENT_BUDGET_TOKENS = 128_000;

type Keys = Readonly<Partial<Record<InstantEvalLlmJudgeWire, string>>>;

export class HttpInstantEvalLlmJudgeChannel implements InstantEvalLlmJudgeChannel {
  private constructor(
    private readonly keys: Keys,
    private readonly dispatcher: Dispatcher | undefined,
    private readonly logger: InstantEvalLlmJudgeLogger,
  ) {}

  /** A wire with no key skips as not configured; `dispatcher` is a suite's stand-in socket. */
  static create({
    keys,
    dispatcher,
    logger = defaultLogger,
  }: {
    keys: Keys;
    dispatcher?: Dispatcher;
    logger?: InstantEvalLlmJudgeLogger;
  }): HttpInstantEvalLlmJudgeChannel {
    return new HttpInstantEvalLlmJudgeChannel(keys, dispatcher, logger);
  }

  isConfigured(wire: InstantEvalLlmJudgeWire): boolean {
    return this.keys[wire] !== undefined;
  }

  async judge(
    { wire, model, job, question, text, timeoutMs, reasoningEffort }: InstantEvalLlmJudgeRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmJudgeAnswer> {
    const apiKey = this.keys[wire];
    if (!apiKey || !model) return skipped("classifier_not_configured");
    const fitted = prepareInstantEvalText({ text, budgetTokens: LLM_CONTENT_BUDGET_TOKENS });
    const prompt = instantEvalLlmJudgePromptOf({ job, question, text: fitted.text });
    const body = instantEvalLlmJudgeBodyOf({
      wire,
      model,
      prompt,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    const sent = await this.post({ wire, apiKey, body, signal, timeoutMs });
    if (sent.outcome === "skipped") return sent;
    const reading = readInstantEvalLlmJudgeAnswer({ wire, body: sent.body, question });
    const { inputTokens, outputTokens } = reading;
    if (reading.outcome === "none") {
      this.logger.warn(
        { wire, kind: question.kind, stoppedBy: reading.stoppedBy, reasoningEffort },
        reading.stoppedBy
          ? "Instant Evals LLM leg stopped before its evaluation call"
          : "Instant Evals LLM leg answered without a readable evaluation call",
      );
      return { outcome: "skipped", reason: "classifier_failed", inputTokens, outputTokens };
    }
    return { outcome: "answered", ...reading.value, inputTokens, outputTokens };
  }

  async call(
    { wire, model, system, user, tools, forcedTool, timeoutMs }: InstantEvalLlmToolCallRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmToolCallAnswer> {
    const apiKey = this.keys[wire];
    if (!apiKey || !model) return skipped("classifier_not_configured");
    const fitted = prepareInstantEvalText({ text: user, budgetTokens: LLM_CONTENT_BUDGET_TOKENS });
    const prompt = { system, user: fitted.text, tools, ...(forcedTool ? { forcedTool } : {}) };
    const body = instantEvalLlmToolCallBodyOf({ wire, model, prompt });
    const sent = await this.post({ wire, apiKey, body, signal, timeoutMs });
    if (sent.outcome === "skipped") return sent;
    const offered = forcedTool ? [forcedTool] : tools.map((tool) => tool.name);
    const reading = readInstantEvalLlmToolCall({ wire, body: sent.body, tools: offered });
    const { inputTokens, outputTokens } = reading;
    if (reading.outcome === "none") {
      this.logger.warn({ wire }, "Instant Evals LLM leg answered without calling an offered tool");
      return { outcome: "skipped", reason: "classifier_failed", inputTokens, outputTokens };
    }
    const { tool, input } = reading;
    return { outcome: "answered", tool, input, inputTokens, outputTokens };
  }

  /** One send, never a retry: the parsed answer, or the platform's skip for what went wrong. */
  private async post({
    wire,
    apiKey,
    body,
    signal,
    timeoutMs,
  }: {
    wire: InstantEvalLlmJudgeWire;
    apiKey: string;
    body: Record<string, unknown>;
    signal: AbortSignal | undefined;
    timeoutMs: number;
  }): Promise<Readonly<{ outcome: "sent"; body: unknown }> | SkippedAnswer> {
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(ENDPOINTS[wire], {
        method: "POST",
        headers: { ...authHeadersOf({ wire, apiKey }), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal({ signal, timeoutMs }),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return this.skip({ wire, reason: "classifier_provider_unavailable" });
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      const { reason } = decisionFailureOf({ status: response.status, isOwnModel: false });
      return this.skip({ wire, reason, status: response.status });
    }
    return { outcome: "sent", body: await response.json().catch(() => undefined) };
  }

  private skip({
    wire,
    reason,
    status,
  }: {
    wire: InstantEvalLlmJudgeWire;
    reason: InstantEvalSkipReason;
    status?: number;
  }): SkippedAnswer {
    this.logger.warn({ wire, reason, status }, "Instant Evals LLM leg did not answer");
    return skipped(reason);
  }
}

type SkippedAnswer = Extract<InstantEvalLlmJudgeAnswer, { outcome: "skipped" }>;

function skipped(reason: InstantEvalSkipReason): SkippedAnswer {
  return { outcome: "skipped", reason, inputTokens: 0, outputTokens: 0 };
}

function authHeadersOf({
  wire,
  apiKey,
}: {
  wire: InstantEvalLlmJudgeWire;
  apiKey: string;
}): Record<string, string> {
  return wire === "anthropic_messages"
    ? { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }
    : { authorization: `Bearer ${apiKey}` };
}

function requestSignal({
  signal,
  timeoutMs,
}: {
  signal: AbortSignal | undefined;
  timeoutMs: number;
}): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
