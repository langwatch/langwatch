/**
 * One scenario judgement's whole-call LLM leg: the judge's own verdict call, sent once per backend
 * however many criteria need it, and billed once. Only the caller's stop is rethrown.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import {
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
import { instantEvalJudgeLlmCallPermitOf } from "../rules/instant-eval-judge-route.rules.ts";
import {
  findInstantEvalScenarioVerdictReading,
  type InstantEvalScenarioVerdictReading,
} from "../rules/instant-eval-scenario-judge.rules.ts";

/** Which backend sends the judge's own call: its wire, model, time, effort and output cap. */
export type InstantEvalScenarioLlmVerdictCall = Pick<
  InstantEvalLlmToolCallRequest,
  "wire" | "model" | "timeoutMs" | "reasoningEffort" | "maxOutputTokens"
>;

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
  private readonly reasonings = new Map<string, string>();

  private constructor(private readonly input: ScenarioLlmVerdictInput) {}

  static create(input: ScenarioLlmVerdictInput): InstantEvalScenarioLlmVerdictService {
    return new InstantEvalScenarioLlmVerdictService(input);
  }

  /** The explanation the backend's whole call gave; empty when it sent none or did not answer. */
  explanationOf(backend: string): string {
    return this.reasonings.get(backend) ?? "";
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
    call: InstantEvalScenarioLlmVerdictCall;
    paid: (spend: { inputTokens: number; outputTokens: number }) => void;
  }): Promise<ScenarioLlmVerdict> {
    const sent = this.sends.get(backend);
    if (sent) return sent;
    const send = this.send({ backend, call, paid });
    this.sends.set(backend, send);
    return send;
  }

  private async send({
    backend,
    call,
    paid,
  }: {
    backend: string;
    call: InstantEvalScenarioLlmVerdictCall;
    paid: (spend: { inputTokens: number; outputTokens: number }) => void;
  }): Promise<ScenarioLlmVerdict> {
    const { llmJudge, limiter, projectId, llmCall, signal } = this.input;
    const { system, user } = llmCall;
    const tools = llmCall.tools.filter((tool) => tool.name === INSTANT_EVAL_SCENARIO_VERDICT_TOOL);
    if (tools.length === 0) return { outcome: "failed", reason: "classifier_failed" };
    try {
      await limiter.acquire(instantEvalJudgeLlmCallPermitOf({ projectId, system, user }), signal);
      const answer = await llmJudge.call(
        { ...call, system, user, tools, forcedTool: INSTANT_EVAL_SCENARIO_VERDICT_TOOL },
        ...(signal ? [signal] : []),
      );
      paid({ inputTokens: answer.inputTokens, outputTokens: answer.outputTokens });
      if (answer.outcome !== "answered") return { outcome: "failed", reason: answer.reason };
      const reading = findInstantEvalScenarioVerdictReading(answer.input);
      if (!reading) return { outcome: "failed", reason: "classifier_failed" };
      if (reading.reasoning) this.reasonings.set(backend, reading.reasoning);
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
