/**
 * The Gemini LLM leg over a stand-in socket: where the request goes, where the key rides, what is
 * sent and read back for the judge's own call and for a routed question. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */
import type { InstantEvalQuestion } from "@langwatch/instant-eval-judge-contract";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpInstantEvalLlmJudgeChannel } from "../http/http.instant-eval-llm-judge.channel.ts";

const HOST = "https://generativelanguage.googleapis.com";
const PATH = "/v1beta/models/llm-model-c:generateContent";

const FINISH = {
  name: "finish_test",
  description: "Complete the test with a final verdict",
  parameters: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    properties: {
      criteria: { type: "object", additionalProperties: false, properties: {} },
    },
  },
};

type Sent = { path: string; headers: Record<string, string>; body: Record<string, unknown> };

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

function llm() {
  return HttpInstantEvalLlmJudgeChannel.create({
    keys: { gemini_generate_content: "lw-gemini" },
    dispatcher: agent,
  });
}

function reply(status: number, body: unknown): { sent: Sent[] } {
  const sent: Sent[] = [];
  agent
    .get(HOST)
    .intercept({ path: (path) => path.startsWith("/v1beta/models/"), method: "POST" })
    .reply(status, (options) => {
      sent.push({
        path: options.path,
        headers: options.headers as Record<string, string>,
        body: JSON.parse(typeof options.body === "string" ? options.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return body as object;
    })
    .persist();
  return { sent };
}

const toolCall = {
  wire: "gemini_generate_content" as const,
  model: "llm-model-c",
  system: "You are an LLM as a judge delivering the final verdict",
  user: "<transcript>user: my order is late</transcript>",
  tools: [FINISH],
  forcedTool: "finish_test",
  timeoutMs: 1_000,
};

const question = (asked: InstantEvalQuestion) => ({
  wire: "gemini_generate_content" as const,
  model: "llm-model-c",
  job: "scenario_judge" as const,
  question: asked,
  text: "user: my order is late",
  timeoutMs: 1_000,
});

describe("HttpInstantEvalLlmJudgeChannel on a Gemini backend", () => {
  describe("when the judge's own call is sent", () => {
    /** @scenario "A Gemini backend answers the judge's own call as a forced function call" */
    it("posts to the model's path with the key in a header and reads the function call", async () => {
      const { sent } = reply(200, {
        candidates: [
          {
            content: {
              parts: [
                { text: "thinking aloud" },
                {
                  functionCall: {
                    name: "finish_test",
                    args: { criteria: { criterion_0: "true" } },
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 9_000,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 260,
        },
      });

      const answer = await llm().call(toolCall);

      expect(answer).toEqual({
        outcome: "answered",
        tool: "finish_test",
        input: { criteria: { criterion_0: "true" } },
        inputTokens: 9_000,
        outputTokens: 300,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.path).toBe(PATH);
      expect(sent[0]?.path).not.toContain("lw-gemini");
      expect(sent[0]?.headers["x-goog-api-key"]).toBe("lw-gemini");
      expect(sent[0]?.headers).not.toHaveProperty("authorization");
      expect(sent[0]?.body).toEqual({
        systemInstruction: { parts: [{ text: toolCall.system }] },
        contents: [{ role: "user", parts: [{ text: toolCall.user }] }],
        tools: [
          {
            functionDeclarations: [
              {
                name: "finish_test",
                description: "Complete the test with a final verdict",
                parameters: {
                  type: "object",
                  properties: { criteria: { type: "object", properties: {} } },
                },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["finish_test"] },
        },
        generationConfig: { maxOutputTokens: 8000 },
      });
    });

    /** @scenario "A Gemini backend answers the judge's own call as a forced function call" */
    it("allows every offered tool when none is forced", async () => {
      const { sent } = reply(200, {
        candidates: [{ content: { parts: [{ functionCall: { name: "make_verdict" } }] } }],
      });
      const offered = [
        { name: "continue_test", description: "Go on", parameters: { type: "object" } },
        { name: "make_verdict", description: "Judge now", parameters: { type: "object" } },
      ];
      const { forcedTool: _forced, ...unforced } = toolCall;

      const answer = await llm().call({ ...unforced, tools: offered });

      expect(answer).toMatchObject({ outcome: "answered", tool: "make_verdict", input: {} });
      expect(sent[0]?.body.toolConfig).toEqual({
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["continue_test", "make_verdict"],
        },
      });
    });

    /** @scenario "A provider failure of the judge's own call is a failed leg, never a retry" */
    it.each([
      [429, "classifier_rate_limited"],
      [503, "classifier_provider_unavailable"],
    ] as const)("skips a %i after one send", async (status, reason) => {
      const { sent } = reply(status, { error: { message: "provider text that must not surface" } });

      const answer = await llm().call(toolCall);

      expect(answer).toEqual({ outcome: "skipped", reason, inputTokens: 0, outputTokens: 0 });
      expect(sent).toHaveLength(1);
    });

    /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
    it("bills an answer that called no offered tool and reads none from it", async () => {
      reply(200, {
        candidates: [{ content: { parts: [{ text: "I would rather not" }] } }],
        usageMetadata: { promptTokenCount: 9_000, candidatesTokenCount: 12 },
      });

      const answer = await llm().call(toolCall);

      expect(answer).toEqual({
        outcome: "skipped",
        reason: "classifier_failed",
        inputTokens: 9_000,
        outputTokens: 12,
      });
    });
  });

  describe("when a routed question reaches it", () => {
    const evaluation = (args: unknown) => ({
      candidates: [{ content: { parts: [{ functionCall: { name: "evaluation", args } }] } }],
      usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 30, thoughtsTokenCount: 70 },
    });

    /** @scenario "A Gemini backend answers a routed question of any kind" */
    it("reads a yes or no answer from the evaluation function", async () => {
      const { sent } = reply(200, evaluation({ reasoning: "r", result: false }));

      const answer = await llm().judge(
        question({ id: "refund", kind: "boolean", instructions: "Was a refund offered?" }),
      );

      expect(answer).toEqual({
        outcome: "answered",
        verdict: false,
        inputTokens: 700,
        outputTokens: 100,
      });
      expect(sent[0]?.path).toBe(PATH);
      expect(sent[0]?.body.toolConfig).toEqual({
        functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["evaluation"] },
      });
    });

    /** @scenario "A Gemini backend answers a routed question of any kind" */
    it("reads a score and a category", async () => {
      reply(200, evaluation({ reasoning: "r", score: 4, label: "billing" }));

      const score = await llm().judge(
        question({ id: "s", kind: "score", instructions: "Rate it", range: { min: 1, max: 5 } }),
      );
      const label = await llm().judge(
        question({
          id: "c",
          kind: "category",
          instructions: "Which topic?",
          options: [
            { name: "billing", description: "About an invoice" },
            { name: "shipping", description: "About a delivery" },
          ],
        }),
      );

      expect(score).toMatchObject({ outcome: "answered", score: 4 });
      expect(label).toMatchObject({ outcome: "answered", label: "billing" });
    });
  });

  /** @scenario "A Gemini call on an install with no Gemini key is skipped and sends nothing" */
  it("skips when this install holds no Gemini key, sending nothing", async () => {
    const channel = HttpInstantEvalLlmJudgeChannel.create({
      keys: { openai_responses: "lw-openai" },
      dispatcher: agent,
    });

    expect(channel.isConfigured("gemini_generate_content")).toBe(false);
    await expect(channel.call(toolCall)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "classifier_not_configured",
    });
  });
});
