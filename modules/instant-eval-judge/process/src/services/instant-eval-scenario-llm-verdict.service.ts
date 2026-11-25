/**
 * One scenario judgement's whole-call LLM leg: the judge's own verdict call, sent once per backend
 * however many criteria need it, and billed once. Only the caller's stop is rethrown.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import {
  estimateJudgedTextTokens,
  INSTANT_EVAL_SCENARIO_VERDICT_TOOL,
  type InstantEvalScenarioJudgeCall,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import type { Logger } from "@langwatch/observability";

import type { InstantEvalRateLimiter } from "../channels/instant-eval-classifier.channel.ts";
import type {
  InstantEvalLlmJudgeChannel,
  InstantEvalLlmToolCallRequest,
} from "../channels/instant-eval-llm-judge.channel.ts";
import {
  findInstantEvalScenarioVerdictReading,
  type InstantEvalScenarioVerdictReading,
} from "../rules/instant-eval-scenario-judge.rules.ts";

type ScenarioLlmVerdict =
  | (Readonly<{ outcome: "read" }> & InstantEvalScenarioVerdictReading)
  | Readonly<{ outcome: "failed"; reason: InstantEvalSkipReason }>;

type ScenarioLlmVerdictInput = Readonly<{
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
  projectId: string;
  llmCall: InstantEvalScenarioJudgeCall["llmCall"];
  signal: AbortSignal | undefined;
  logger: Pick<Logger, "error">;
}>;

export class InstantEvalScenarioLlmVerdictService {
  private readonly sends = new Map<string, Promise<ScenarioLlmVerdict>>();
  private firstReasoning = "";

  private constructor(private readonly input: ScenarioLlmVerdictInput) {}

  static create(input: ScenarioLlmVerdictInput): InstantEvalScenarioLlmVerdictService {
    return new InstantEvalScenarioLlmVerdictService(input);
  }

  /** The explanation of the first whole call that answered; empty when none did. */
  explanation(): string {
    return this.firstReasoning;
  }

  /**
   * A backend's reading of the whole call. The first criterion to ask sends it and its run is
   * billed the tokens through `paid`; every later criterion reads the same answer at no cost.
   */
  read({
    backend,
    call,
    paid,
  }: {
    backend: string;
    call: Pick<InstantEvalLlmToolCallRequest, "wire" | "model" | "timeoutMs">;
    paid: (spend: { inputTokens: number; outputTokens: number }) => void;
  }): Promise<ScenarioLlmVerdict> {
    const sent = this.sends.get(backend);
    if (sent) return sent;
    const send = this.send({ call, paid });
    this.sends.set(backend, send);
    return send;
  }

  private async send({
    call,
    paid,
  }: {
    call: Pick<InstantEvalLlmToolCallRequest, "wire" | "model" | "timeoutMs">;
    paid: (spend: { inputTokens: number; outputTokens: number }) => void;
  }): Promise<ScenarioLlmVerdict> {
    const { llmJudge, limiter, projectId, llmCall, signal } = this.input;
    const { system, user } = llmCall;
    const tools = llmCall.tools.filter((tool) => tool.name === INSTANT_EVAL_SCENARIO_VERDICT_TOOL);
    if (tools.length === 0) return { outcome: "failed", reason: "classifier_failed" };
    try {
      await limiter.acquire(
        {
          tokens:
            estimateJudgedTextTokens({ text: system }) + estimateJudgedTextTokens({ text: user }),
          tenantId: `${projectId}:llm`,
        },
        signal,
      );
      const answer = await llmJudge.call(
        { ...call, system, user, tools, forcedTool: INSTANT_EVAL_SCENARIO_VERDICT_TOOL },
        ...(signal ? [signal] : []),
      );
      paid({ inputTokens: answer.inputTokens, outputTokens: answer.outputTokens });
      if (answer.outcome !== "answered") return { outcome: "failed", reason: answer.reason };
      const reading = findInstantEvalScenarioVerdictReading(answer.input);
      if (!reading) return { outcome: "failed", reason: "classifier_failed" };
      this.firstReasoning ||= reading.reasoning ?? "";
      return { outcome: "read", ...reading };
    } catch (error) {
      if (signal?.aborted) throw error;
      this.input.logger.error(
        { wire: call.wire, error },
        "Instant Evals scenario verdict call threw",
      );
      return { outcome: "failed", reason: "classifier_failed" };
    }
  }
}
