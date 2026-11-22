/**
 * The router's LLM legs and hosted Decisions leg over a stand-in socket: the forced tool call
 * each sends, the verdict read back, and the skip each failure maps to. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalBooleanQuestion,
  InstantEvalCategoryQuestion,
  InstantEvalScoreQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const POLITE: InstantEvalScoreQuestion = {
  id: "polite",
  kind: "score",
  instructions: "Rate how polite the reply is.",
  range: { min: 1, max: 5 },
};

const TOPIC: InstantEvalCategoryQuestion = {
  id: "topic",
  kind: "category",
  instructions: "Which topic does the user ask about?",
  options: [
    { name: "billing", description: "invoices and charges" },
    { name: "shipping", description: "" },
  ],
};

function anthropicAnswering(
  input: Record<string, unknown>,
  sent: { body?: Record<string, unknown> },
) {
  agent
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(200, (options) => {
      sent.body = JSON.parse(sentText(options.body)) as Record<string, unknown>;
      return {
        content: [{ type: "tool_use", name: "evaluation", input: { reasoning: "r", ...input } }],
        usage: { input_tokens: 300, output_tokens: 40 },
      };
    });
}

describe("HttpInstantEvalLlmJudgeChannel, given a score or category question", () => {
  /** @scenario "The LLM legs send one forced score or category tool call and read it back" */
  it("asks an evaluator's score on its range and reads the number back", async () => {
    const sent: { body?: Record<string, unknown> } = {};
    anthropicAnswering({ score: 4 }, sent);

    const answer = await llm().judge({
      ...request("anthropic_messages"),
      job: "llm_judge",
      question: POLITE,
    });

    expect(answer).toEqual({ outcome: "answered", score: 4, inputTokens: 300, outputTokens: 40 });
    const [tool] = (sent.body?.tools ?? []) as {
      input_schema: { properties: Record<string, unknown> };
    }[];
    expect(tool?.input_schema.properties.score).toEqual({
      type: "number",
      minimum: 1,
      maximum: 5,
      description: "The score on the instructions' scale, from 1 to 5.",
    });
    expect(String(sent.body?.system)).toContain("on a scale from 1 (the lowest they allow) to 5");
    expect(String(sent.body?.system)).toContain("map it linearly onto this one");
    expect(JSON.stringify(sent.body?.messages)).toContain("Score from 1 to 5.");
  });

  /** @scenario "The LLM legs send one forced score or category tool call and read it back" */
  it.each([[9], ["high"], [null]])(
    "reads a score of %j, outside the range or not a number, as no answer",
    async (score) => {
      anthropicAnswering({ score }, {});

      const answer = await llm().judge({ ...request("anthropic_messages"), question: POLITE });

      expect(answer).toMatchObject({
        outcome: "skipped",
        reason: "classifier_failed",
        inputTokens: 300,
      });
    },
  );

  /** @scenario "The LLM legs send one forced score or category tool call and read it back" */
  it("asks a search category from the offered names and reads a label, ignoring case", async () => {
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
              arguments: JSON.stringify({ reasoning: "r", label: " Shipping " }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 50 },
        };
      });

    const answer = await llm().judge({ ...request("openai_responses"), question: TOPIC });

    expect(answer).toMatchObject({ outcome: "answered", label: "shipping" });
    const [tool] = sent.tools as { parameters: { properties: { label: { enum: string[] } } } }[];
    expect(tool?.parameters.properties.label.enum).toEqual(["billing", "shipping"]);
    const [, user] = sent.input as { content: string }[];
    expect(user?.content).toContain(
      "Answer this question about the text above with one of the categories below: Which topic does the user ask about?\n\n# Categories\n- billing: invoices and charges\n- shipping",
    );
  });

  /** @scenario "The LLM legs send one forced score or category tool call and read it back" */
  it("reads a label the question never offered as no answer", async () => {
    anthropicAnswering({ label: "refunds" }, {});

    const answer = await llm().judge({ ...request("anthropic_messages"), question: TOPIC });

    expect(answer).toMatchObject({ outcome: "skipped", reason: "classifier_failed" });
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
      apiKey: "lw-decisions",
      dispatcher: agent,
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

  /** @scenario "A decision-model leg is billed for its output tokens too" */
  it("keeps the billed output tokens too, so the leg is priced for them", async () => {
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/decisions", method: "POST" })
      .reply(200, {
        answers: [{ type: "predicate", name: "upset", probability: 0.81 }],
        usage: { input_tokens: 1000, output_tokens: 12 },
      });
    const channel = HttpInstantEvalHostedDecisionsChannel.create({
      apiKey: "lw-decisions",
      dispatcher: agent,
    });

    const judgement = await channel.classify({
      text: "user: late",
      questions: [QUESTION],
      model: "decision-model-a",
    });

    expect(judgement).toMatchObject({ inputTokens: 1000, outputTokens: 12 });
  });

  /** @scenario "Decisions and LLM legs draw on the rate limiter too" */
  it("sends once per call through a 429 and a 503, so each send is one the router paced", async () => {
    let sends = 0;
    const reply = (statusCode: number, body: unknown = {}) =>
      agent
        .get("https://api.openai.com")
        .intercept({ path: "/v1/decisions", method: "POST" })
        .reply(() => {
          sends += 1;
          return { statusCode, data: JSON.stringify(body) };
        });
    reply(429);
    reply(503);
    reply(200, {
      answers: [{ type: "predicate", name: "upset", probability: 0.81 }],
      usage: { input_tokens: 1000 },
    });
    const channel = HttpInstantEvalHostedDecisionsChannel.create({
      apiKey: "lw-decisions",
      dispatcher: agent,
    });
    const call = () =>
      channel.classify({ text: "user: late", questions: [QUESTION], model: "decision-model-a" });

    expect((await call()).skippedReason).toBeDefined();
    expect(sends).toBe(1);
    expect((await call()).skippedReason).toBe("classifier_provider_unavailable");
    expect(sends).toBe(2);
    const answered = await call();
    expect(sends).toBe(3);
    expect(answered.verdicts).toEqual([{ questionId: "upset", probability: 0.81 }]);
  });
});
