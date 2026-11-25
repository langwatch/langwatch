/**
 * The judge's own tool call on each LLM wire: the body sent and the call read back.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */
import { describe, expect, it } from "vitest";

import {
  instantEvalLlmToolCallBodyOf,
  readInstantEvalLlmToolCall,
} from "../instant-eval-llm-tool-call-wire.rules.ts";

const FINISH = {
  name: "finish_test",
  description: "Complete the test with a final verdict",
  parameters: { type: "object", properties: { criteria: { type: "object" } } },
};
const CONTINUE = { name: "continue_test", description: "Continue", parameters: { type: "object" } };
const VERDICT = { name: "make_verdict", description: "Judge now", parameters: { type: "object" } };

describe("instantEvalLlmToolCallBodyOf", () => {
  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("forces the named tool on Anthropic Messages, with the judge's own messages", () => {
    const body = instantEvalLlmToolCallBodyOf({
      wire: "anthropic_messages",
      model: "llm-model-a",
      prompt: { system: "judge", user: "transcript", tools: [FINISH], forcedTool: "finish_test" },
    });

    expect(body).toEqual({
      model: "llm-model-a",
      max_tokens: 8000,
      system: "judge",
      messages: [{ role: "user", content: "transcript" }],
      tools: [
        { name: "finish_test", description: FINISH.description, input_schema: FINISH.parameters },
      ],
      tool_choice: { type: "tool", name: "finish_test" },
    });
  });

  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("forces the named function on OpenAI Responses and stores nothing", () => {
    const body = instantEvalLlmToolCallBodyOf({
      wire: "openai_responses",
      model: "llm-model-b",
      prompt: { system: "judge", user: "transcript", tools: [FINISH], forcedTool: "finish_test" },
    });

    expect(body).toEqual({
      model: "llm-model-b",
      input: [
        { role: "developer", content: "judge" },
        { role: "user", content: "transcript" },
      ],
      max_output_tokens: 8000,
      store: false,
      tools: [{ type: "function", ...FINISH, strict: false }],
      tool_choice: { type: "function", name: "finish_test" },
    });
  });

  it("requires one of the offered tools when none is forced", () => {
    const prompt = { system: "judge", user: "transcript", tools: [CONTINUE, VERDICT] };

    const anthropic = instantEvalLlmToolCallBodyOf({
      wire: "anthropic_messages",
      model: "m",
      prompt,
    });
    const openAi = instantEvalLlmToolCallBodyOf({ wire: "openai_responses", model: "m", prompt });

    expect(anthropic.tool_choice).toEqual({ type: "any" });
    expect(openAi.tool_choice).toBe("required");
  });
});

describe("readInstantEvalLlmToolCall", () => {
  /** @scenario "The judge's own call is sent on the leg's wire with its tool forced" */
  it("reads the called tool, its arguments and the billed tokens on each wire", () => {
    const anthropic = readInstantEvalLlmToolCall({
      wire: "anthropic_messages",
      tools: ["finish_test"],
      body: {
        content: [
          { type: "text", text: "thinking" },
          { type: "tool_use", name: "finish_test", input: { criteria: { a: "true" } } },
        ],
        usage: { input_tokens: 900, output_tokens: 40 },
      },
    });
    const openAi = readInstantEvalLlmToolCall({
      wire: "openai_responses",
      tools: ["continue_test", "make_verdict"],
      body: {
        output: [
          { type: "reasoning" },
          { type: "function_call", name: "make_verdict", arguments: "{}" },
        ],
        usage: { input_tokens: 700, output_tokens: 30 },
      },
    });

    expect(anthropic).toEqual({
      outcome: "called",
      tool: "finish_test",
      input: { criteria: { a: "true" } },
      inputTokens: 900,
      outputTokens: 40,
    });
    expect(openAi).toEqual({
      outcome: "called",
      tool: "make_verdict",
      input: {},
      inputTokens: 700,
      outputTokens: 30,
    });
  });

  it("reads no call from a tool that was not offered, and still bills the tokens", () => {
    const reading = readInstantEvalLlmToolCall({
      wire: "openai_responses",
      tools: ["finish_test"],
      body: {
        output: [{ type: "function_call", name: "expand_trace", arguments: "{}" }],
        usage: { input_tokens: 700, output_tokens: 30 },
      },
    });

    expect(reading).toEqual({ outcome: "none", inputTokens: 700, outputTokens: 30 });
  });

  it("reads no call from arguments that are not JSON or a body of another shape", () => {
    const badArguments = readInstantEvalLlmToolCall({
      wire: "openai_responses",
      tools: ["finish_test"],
      body: {
        output: [{ type: "function_call", name: "finish_test", arguments: "{not json" }],
        usage: { input_tokens: 5, output_tokens: 1 },
      },
    });
    const otherShape = readInstantEvalLlmToolCall({
      wire: "anthropic_messages",
      tools: ["finish_test"],
      body: { error: "overloaded" },
    });

    expect(badArguments).toEqual({ outcome: "none", inputTokens: 5, outputTokens: 1 });
    expect(otherShape).toEqual({ outcome: "none", inputTokens: 0, outputTokens: 0 });
  });
});
