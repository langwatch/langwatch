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
  instantEvalLlmContentBudgetTokensOf,
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

const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Gemini names its model in the path; the key never rides in the URL. */
function endpointOf({ wire, model }: { wire: InstantEvalLlmJudgeWire; model: string }): string {
  if (wire === "anthropic_messages") return "https://api.anthropic.com/v1/messages";
  if (wire === "openai_responses") return "https://api.openai.com/v1/responses";
  return `${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:generateContent`;
}

const ANTHROPIC_VERSION = "2023-06-01";

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
    {
      wire,
      model,
      job,
      question,
      text,
      timeoutMs,
      reasoningEffort,
      maxOutputTokens,
    }: InstantEvalLlmJudgeRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmJudgeAnswer> {
    const apiKey = this.keys[wire];
    if (!apiKey || !model) return skipped("classifier_not_configured");
    const fitted = prepareInstantEvalText({
      text,
      budgetTokens: instantEvalLlmContentBudgetTokensOf(wire),
    });
    const prompt = instantEvalLlmJudgePromptOf({ job, question, text: fitted.text });
    const body = instantEvalLlmJudgeBodyOf({
      wire,
      model,
      prompt,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    });
    const sent = await this.post({ wire, model, apiKey, body, signal, timeoutMs });
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
    request: InstantEvalLlmToolCallRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmToolCallAnswer> {
    const { wire, model, system, user, tools, forcedTool, timeoutMs, reasoningEffort } = request;
    const { maxOutputTokens } = request;
    const apiKey = this.keys[wire];
    if (!apiKey || !model) return skipped("classifier_not_configured");
    const fitted = prepareInstantEvalText({
      text: user,
      budgetTokens: instantEvalLlmContentBudgetTokensOf(wire),
    });
    const prompt = { system, user: fitted.text, tools, ...(forcedTool ? { forcedTool } : {}) };
    const body = instantEvalLlmToolCallBodyOf({
      wire,
      model,
      prompt,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    });
    const sent = await this.post({ wire, model, apiKey, body, signal, timeoutMs });
    if (sent.outcome === "skipped") return sent;
    const offered = forcedTool ? [forcedTool] : tools.map((tool) => tool.name);
    const reading = readInstantEvalLlmToolCall({ wire, body: sent.body, tools: offered });
    const { inputTokens, outputTokens } = reading;
    if (reading.outcome === "none") {
      this.logger.warn(
        { wire, stoppedBy: reading.stoppedBy },
        reading.stoppedBy
          ? "Instant Evals LLM leg stopped before calling an offered tool"
          : "Instant Evals LLM leg answered without calling an offered tool",
      );
      return { outcome: "skipped", reason: "classifier_failed", inputTokens, outputTokens };
    }
    const { tool, input } = reading;
    return { outcome: "answered", tool, input, inputTokens, outputTokens };
  }

  /** One send, never a retry: the parsed answer, or the platform's skip for what went wrong. */
  private async post({
    wire,
    model,
    apiKey,
    body,
    signal,
    timeoutMs,
  }: {
    wire: InstantEvalLlmJudgeWire;
    model: string;
    apiKey: string;
    body: Record<string, unknown>;
    signal: AbortSignal | undefined;
    timeoutMs: number;
  }): Promise<Readonly<{ outcome: "sent"; body: unknown }> | SkippedAnswer> {
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(endpointOf({ wire, model }), {
        method: "POST",
        headers: { ...authHeadersOf({ wire, apiKey }), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal({ signal, timeoutMs }),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        ...this.skip({ wire, reason: "classifier_provider_unavailable" }),
        isUsageUnread: true,
      };
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      const { reason } = decisionFailureOf({ status: response.status, isOwnModel: false });
      return this.skip({ wire, reason, status: response.status });
    }
    const parsed: unknown = await response.json().catch(() => undefined);
    // A body cut off mid-read (the timeout fires after the headers) carries no usage either.
    if (parsed === undefined) {
      return { ...this.skip({ wire, reason: "classifier_failed" }), isUsageUnread: true };
    }
    return { outcome: "sent", body: parsed };
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
  if (wire === "anthropic_messages") {
    return { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
  }
  if (wire === "gemini_generate_content") return { "x-goog-api-key": apiKey };
  return { authorization: `Bearer ${apiKey}` };
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
