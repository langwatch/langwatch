/**
 * The judge's own tool call over a stand-in socket: what is sent on each wire, what is read back,
 * and the skip a provider failure maps to after one send. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpInstantEvalLlmJudgeChannel } from "../http/http.instant-eval-llm-judge.channel.ts";

const FINISH = {
  name: "finish_test",
  description: "Complete the test with a final verdict",
  parameters: { type: "object", properties: { criteria: { type: "object" } } },
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
  model: "llm-model",
  system: "You are an LLM as a judge delivering the final verdict",
  user: "<transcript>user: my order is late</transcript>",
  tools: [FINISH],
  forcedTool: "finish_test",
  timeoutMs: 1_000,
});

describe("HttpInstantEvalLlmJudgeChannel.call", () => {
  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("sends the judge's messages to OpenAI Responses and reads the forced function call", async () => {
    let sent: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/responses", method: "POST" })
      .reply(200, (options) => {
        sent = JSON.parse(sentText(options.body)) as Record<string, unknown>;
        headers = options.headers as Record<string, string>;
        return {
          output: [
            {
              type: "function_call",
              name: "finish_test",
              arguments: JSON.stringify({ criteria: { criterion_0: "true" }, reasoning: "r" }),
            },
          ],
          usage: { input_tokens: 800, output_tokens: 60 },
        };
      });

    const answer = await llm().call(request("openai_responses"));

    expect(answer).toEqual({
      outcome: "answered",
      tool: "finish_test",
      input: { criteria: { criterion_0: "true" }, reasoning: "r" },
      inputTokens: 800,
      outputTokens: 60,
    });
    expect(headers.authorization).toBe("Bearer lw-openai");
    expect(sent.tool_choice).toEqual({ type: "function", name: "finish_test" });
    expect(sent.input).toEqual([
      { role: "developer", content: "You are an LLM as a judge delivering the final verdict" },
      { role: "user", content: "<transcript>user: my order is late</transcript>" },
    ]);
    expect((sent.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["finish_test"]);
  });

  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("sends the judge's messages to Anthropic Messages and reads the forced tool use", async () => {
    let sent: Record<string, unknown> = {};
    agent
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(200, (options) => {
        sent = JSON.parse(sentText(options.body)) as Record<string, unknown>;
        return {
          content: [{ type: "tool_use", name: "finish_test", input: { criteria: {} } }],
          usage: { input_tokens: 300, output_tokens: 20 },
        };
      });

    const answer = await llm().call(request("anthropic_messages"));

    expect(answer).toMatchObject({ outcome: "answered", tool: "finish_test", inputTokens: 300 });
    expect(sent.system).toBe("You are an LLM as a judge delivering the final verdict");
    expect(sent.tool_choice).toEqual({ type: "tool", name: "finish_test" });
  });

  /** @scenario "A provider failure of the judge's own call is a failed leg, never a retry" */
  it.each([
    [429, "classifier_rate_limited"],
    [500, "classifier_provider_unavailable"],
  ] as const)("skips a %i after one send", async (status, reason) => {
    let sends = 0;
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/responses", method: "POST" })
      .reply(status, () => {
        sends += 1;
        return { error: { message: "provider text that must not surface" } };
      })
      .persist();

    const answer = await llm().call(request("openai_responses"));

    expect(answer).toEqual({ outcome: "skipped", reason, inputTokens: 0, outputTokens: 0 });
    expect(sends).toBe(1);
  });

  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("bills the tokens of an answer that called no offered tool", async () => {
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/responses", method: "POST" })
      .reply(200, {
        output: [{ type: "message" }],
        usage: { input_tokens: 800, output_tokens: 60 },
      });

    const answer = await llm().call(request("openai_responses"));

    expect(answer).toEqual({
      outcome: "skipped",
      reason: "classifier_failed",
      inputTokens: 800,
      outputTokens: 60,
    });
  });

  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("skips a wire this install holds no key for, sending nothing", async () => {
    const answer = await llm({ anthropic_messages: "lw-anthropic" } as never).call(
      request("openai_responses"),
    );

    expect(answer).toMatchObject({ outcome: "skipped", reason: "classifier_not_configured" });
  });
});

describe("HttpInstantEvalLlmJudgeChannel.call, given a backend's own output cap", () => {
  function capturing(origin: string, path: string, reply: Record<string, unknown>) {
    const sent: { body?: Record<string, unknown> } = {};
    agent
      .get(origin)
      .intercept({ path, method: "POST" })
      .reply(200, (options) => {
        sent.body = JSON.parse(sentText(options.body)) as Record<string, unknown>;
        return reply;
      });
    return sent;
  }

  /** @scenario "The judge's own calls carry the backend's output cap" */
  it("sends that cap on a reasoning OpenAI call and an Anthropic call, not the default", async () => {
    const openAi = capturing("https://api.openai.com", "/v1/responses", {
      output: [{ type: "function_call", name: "finish_test", arguments: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const anthropic = capturing("https://api.anthropic.com", "/v1/messages", {
      content: [{ type: "tool_use", name: "finish_test", input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await llm().call({
      ...request("openai_responses"),
      reasoningEffort: "high",
      maxOutputTokens: 1_100,
    });
    await llm().call({ ...request("anthropic_messages"), maxOutputTokens: 500 });

    expect(openAi.body?.max_output_tokens).toBe(1_100);
    expect(anthropic.body?.max_tokens).toBe(500);
  });

  /** @scenario "The judge's own calls carry the backend's output cap" */
  it("skips a call stopped at its cap before calling the tool, billing it and logging the stop", async () => {
    capturing("https://api.openai.com", "/v1/responses", {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "reasoning", summary: [] }],
      usage: { input_tokens: 500, output_tokens: 1_100 },
    });
    const warned: unknown[][] = [];

    const answer = await HttpInstantEvalLlmJudgeChannel.create({
      keys: { openai_responses: "lw-openai" },
      dispatcher: agent,
      logger: { warn: (...args: unknown[]) => void warned.push(args) },
    }).call({ ...request("openai_responses"), reasoningEffort: "high", maxOutputTokens: 1_100 });

    expect(answer).toEqual({
      outcome: "skipped",
      reason: "classifier_failed",
      inputTokens: 500,
      outputTokens: 1_100,
    });
    expect(warned).toEqual([
      [
        { wire: "openai_responses", stoppedBy: "max_output_tokens" },
        "Instant Evals LLM leg stopped before calling an offered tool",
      ],
    ]);
  });
});
