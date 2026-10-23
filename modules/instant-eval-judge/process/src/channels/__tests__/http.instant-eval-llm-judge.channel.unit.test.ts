/**
 * The router's LLM legs and hosted Decisions leg over a stand-in socket: the forced tool call
 * each sends, the verdict read back, and the skip each failure maps to. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { InstantEvalBooleanQuestion } from "@langwatch/instant-eval-judge-contract";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpInstantEvalDecisionModelChannel } from "../http/http.instant-eval-decision-model.channel.ts";
import { HttpInstantEvalHostedDecisionsChannel } from "../http/http.instant-eval-hosted-decisions.channel.ts";
import { HttpInstantEvalLlmJudgeChannel } from "../http/http.instant-eval-llm-judge.channel.ts";

const QUESTION: InstantEvalBooleanQuestion = {
  id: "upset",
  kind: "boolean",
  instructions: "Is the user upset?",
};

let agent: MockAgent;

const sentText = (body: unknown): string => (typeof body === "string" ? body : "");

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

function llm(keys = { anthropic_messages: "lw-anthropic", openai_responses: "lw-openai" }) {
  return HttpInstantEvalLlmJudgeChannel.create({ keys, dispatcher: agent });
}

const request = (wire: "anthropic_messages" | "openai_responses") => ({
  wire,
  model: wire === "anthropic_messages" ? "llm-model-a" : "llm-model-b",
  job: "search" as const,
  question: QUESTION,
  text: "user: my order is late",
  timeoutMs: 1_000,
});

describe("HttpInstantEvalLlmJudgeChannel", () => {
  /** @scenario "The LLM legs send one forced yes-or-no tool call and read it back" */
  it("forces the evaluation tool on Anthropic Messages and reads its result", async () => {
    let sent: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    agent
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(200, (options) => {
        sent = JSON.parse(sentText(options.body)) as Record<string, unknown>;
        headers = options.headers as Record<string, string>;
        return {
          content: [
            { type: "tool_use", name: "evaluation", input: { reasoning: "r", result: false } },
          ],
          usage: { input_tokens: 2000, output_tokens: 100 },
        };
      });

    const answer = await llm().judge(request("anthropic_messages"));

    expect(answer).toEqual({
      outcome: "answered",
      verdict: false,
      inputTokens: 2000,
      outputTokens: 100,
    });
    expect(headers["x-api-key"]).toBe("lw-anthropic");
    expect(sent.tool_choice).toEqual({ type: "tool", name: "evaluation" });
    expect(sent.model).toBe("llm-model-a");
    expect(JSON.stringify(sent.messages)).toContain(
      "Answer this question about the text above with true (yes) or false (no): Is the user upset?",
    );
  });

  /** @scenario "The LLM legs send one forced yes-or-no tool call and read it back" */
  it("forces the evaluation function on OpenAI Responses and reads its arguments", async () => {
    let sent: Record<string, unknown> = {};
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/responses", method: "POST" })
      .reply(200, (options) => {
        sent = JSON.parse(sentText(options.body)) as Record<string, unknown>;
        return {
          output: [
            {
              type: "function_call",
              name: "evaluation",
              arguments: JSON.stringify({ reasoning: "r", result: true }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 50 },
        };
      });

    const answer = await llm().judge({ ...request("openai_responses"), job: "llm_judge" });

    expect(answer).toMatchObject({ outcome: "answered", verdict: true, inputTokens: 500 });
    expect(sent.tool_choice).toEqual({ type: "function", name: "evaluation" });
    expect(sent.store).toBe(false);
    const [developer] = sent.input as { content: string }[];
    expect(developer?.content.startsWith("Is the user upset?\n\n")).toBe(true);
  });

  /** @scenario "The LLM legs send one forced yes-or-no tool call and read it back" */
  it.each([
    [401, "classifier_key_invalid"],
    [429, "classifier_rate_limited"],
    [413, "classifier_input_too_large"],
    [503, "classifier_provider_unavailable"],
  ])("maps a %i to %s and keeps no provider text", async (status, reason) => {
    agent
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(status, { error: { message: "secret provider detail" } });

    const answer = await llm().judge(request("anthropic_messages"));

    expect(answer).toEqual({ outcome: "skipped", reason, inputTokens: 0, outputTokens: 0 });
  });

  it("skips an answer without an evaluation call as failed, keeping its billed tokens", async () => {
    agent
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(200, { content: [{ type: "text", text: "yes" }], usage: { input_tokens: 7 } });

    const answer = await llm().judge(request("anthropic_messages"));

    expect(answer).toMatchObject({
      outcome: "skipped",
      reason: "classifier_failed",
      inputTokens: 7,
    });
  });

  it("skips as not configured when the wire has no key, sending nothing", async () => {
    const answer = await llm({ anthropic_messages: "lw-anthropic" } as never).judge(
      request("openai_responses"),
    );
    expect(answer).toMatchObject({ outcome: "skipped", reason: "classifier_not_configured" });
  });

  it("skips as unavailable when the socket fails", async () => {
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/responses", method: "POST" })
      .replyWithError(new Error("socket hang up"));

    const answer = await llm().judge(request("openai_responses"));

    expect(answer).toMatchObject({ outcome: "skipped", reason: "classifier_provider_unavailable" });
  });
});

describe("HttpInstantEvalHostedDecisionsChannel", () => {
  it("asks the Decisions API with LangWatch's key and keeps the billed input tokens", async () => {
    let authorization: unknown;
    let body: unknown;
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/decisions", method: "POST" })
      .reply(200, (options) => {
        authorization = (options.headers as Record<string, string>).authorization;
        body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
        return {
          answers: [{ type: "predicate", name: "upset", probability: 0.81 }],
          usage: { input_tokens: 1000 },
        };
      });
    const channel = HttpInstantEvalHostedDecisionsChannel.create({
      decisionModels: HttpInstantEvalDecisionModelChannel.create({ dispatcher: agent }),
      apiKey: "lw-decisions",
    });

    const judgement = await channel.classify({
      text: "user: late",
      questions: [QUESTION],
      model: "decision-model-a",
    });

    expect(judgement.verdicts).toEqual([{ questionId: "upset", probability: 0.81 }]);
    expect(judgement.inputTokens).toBe(1000);
    expect(authorization).toBe("Bearer lw-decisions");
    // The model is the table's, never a default the code holds.
    expect(body).toMatchObject({ model: "decision-model-a" });
  });
});
