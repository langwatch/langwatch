/**
 * The scenario judge's chat call read as a judge-leaf call, and the leaf's answer formatted as
 * the tool call the judge reads. The requests are the ones the scenario SDK's judge sends.
 * @see modules/scenario/specs/judge-preview.feature
 */
import { JudgePreviewRequestInvalidError } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  decisionRequest,
  verdictRequest,
} from "../../__tests__/support/judge-preview-requests.fixture.ts";
import {
  judgePreviewChatCompletionOf,
  judgePreviewLeafCallOf,
} from "../judge-preview-chat.rules.ts";

const functionCallOf = (completion: ReturnType<typeof judgePreviewChatCompletionOf>) => {
  const call = completion.choices[0]?.message.tool_calls[0]?.function;
  return { name: call?.name, arguments: JSON.parse(call?.arguments ?? "null") as unknown };
};

describe("judgePreviewLeafCallOf", () => {
  describe("given the scenario judge's verdict request", () => {
    /** @scenario "The judge's verdict call becomes one leaf call with a criterion per tool property" */
    it("reads the criteria from the finish_test tool, the scenario block and the user message", () => {
      const call = judgePreviewLeafCallOf(verdictRequest());

      expect(call.phase).toBe("verdict");
      expect(call.criteria).toEqual([
        { key: "the_agent_offers_a_refund", text: "The agent offers a refund" },
        { key: "the_agent_apologises", text: "The agent apologises" },
      ]);
      expect(call.description).toBe("A customer asks for a refund on a late order");
      expect(call.content).toContain("<transcript>");
      expect(call.llmCall.system).toContain("You are an LLM as a judge");
      expect(call.llmCall.user).toBe(call.content);
    });

    /** @scenario "Trace exploration tools are never passed on" */
    it("passes on the finish_test tool alone", () => {
      const call = judgePreviewLeafCallOf(
        verdictRequest({ extraTools: ["expand_trace", "grep_trace", "wait_for_traces"] }),
      );

      expect(call.llmCall.tools.map((tool) => tool.name)).toEqual(["finish_test"]);
    });

    /** @scenario "A custom system prompt without a scenario block is kept whole" */
    it("keeps a system prompt with no scenario block whole as the description", () => {
      const call = judgePreviewLeafCallOf(verdictRequest({ system: "Judge strictly." }));

      expect(call.description).toBe("Judge strictly.");
    });

    /** @scenario "The judge's verdict call becomes one leaf call with a criterion per tool property" */
    it("appends a later user message and reads text parts", () => {
      const request = verdictRequest();
      const call = judgePreviewLeafCallOf({
        ...request,
        messages: [
          ...request.messages,
          { role: "assistant", content: null },
          { role: "user", content: [{ type: "text", text: "Give your final verdict now." }] },
        ],
      });

      expect(call.content.endsWith("\n\nGive your final verdict now.")).toBe(true);
    });
  });

  describe("given the scenario judge's turn decision request", () => {
    /** @scenario "The judge's turn decision call is read as the decision phase" */
    it("reads a decision call with no criteria and the two decision tools", () => {
      const call = judgePreviewLeafCallOf(decisionRequest({ extraTools: ["expand_trace"] }));

      expect(call.phase).toBe("decision");
      expect(call.criteria).toEqual([]);
      expect(call.llmCall.tools.map((tool) => tool.name)).toEqual([
        "continue_test",
        "make_verdict",
      ]);
    });
  });

  describe("given a request that is not a scenario judge call", () => {
    /** @scenario "A request that is not a scenario judge call is refused" */
    it("refuses a chat with no judge tool, saying what the model is for", () => {
      const refuse = () =>
        judgePreviewLeafCallOf({ messages: [{ role: "user", content: "Write me a poem" }] });

      expect(refuse).toThrow(JudgePreviewRequestInvalidError);
      expect(refuse).toThrow("LangWatch Judge (preview) judges scenario runs only.");
    });

    /** @scenario "A request that is not a scenario judge call is refused" */
    it("refuses a request offering only one of the two decision tools", () => {
      const request = decisionRequest();
      const tools = request.tools?.filter((tool) => tool.function.name === "continue_test");

      expect(() => judgePreviewLeafCallOf({ ...request, tools })).toThrow(
        JudgePreviewRequestInvalidError,
      );
    });

    /** @scenario "A streamed request is refused" */
    it("refuses a streamed request, naming stream", () => {
      expect(() => judgePreviewLeafCallOf({ ...verdictRequest(), stream: true })).toThrow(
        /does not stream.*`stream`/,
      );
    });
  });
});

describe("judgePreviewChatCompletionOf", () => {
  const call = judgePreviewLeafCallOf(verdictRequest());
  const format = (
    criteria: { key: string; result: "met" | "unmet" | "inconclusive" }[],
    reasoning?: string,
  ) =>
    judgePreviewChatCompletionOf({
      answer: {
        outcome: "judged",
        phase: "verdict",
        criteria,
        ...(reasoning ? { reasoning } : {}),
        inputTokens: 1234,
        priceUsd: 0.001,
      },
      call,
      id: "chatcmpl_1",
      createdAtSeconds: 1_760_000_000,
    });

  /** @scenario "A verdict is answered as the judge's finish_test tool call" */
  it("answers one finish_test tool call with each criterion by key", () => {
    const completion = format(
      [
        { key: "the_agent_offers_a_refund", result: "met" },
        { key: "the_agent_apologises", result: "unmet" },
        { key: "extra", result: "inconclusive" },
      ],
      "The agent refunded the order and never apologised.",
    );

    expect(completion).toMatchObject({
      id: "chatcmpl_1",
      object: "chat.completion",
      created: 1_760_000_000,
      model: "langwatch/judge-preview",
      usage: { prompt_tokens: 1234, completion_tokens: 0, total_tokens: 1234 },
    });
    expect(completion.choices).toHaveLength(1);
    expect(completion.choices[0]).toMatchObject({
      finish_reason: "tool_calls",
      message: { role: "assistant", content: null },
    });
    expect(functionCallOf(completion)).toEqual({
      name: "finish_test",
      arguments: {
        criteria: {
          the_agent_offers_a_refund: "true",
          the_agent_apologises: "false",
          extra: "inconclusive",
        },
        reasoning: "The agent refunded the order and never apologised.",
        verdict: "failure",
      },
    });
  });

  /** @scenario "The verdict follows the criteria" */
  it("fails on any unmet criterion, else is inconclusive on any unsettled one, else passes", () => {
    const verdictOf = (results: ("met" | "unmet" | "inconclusive")[]) =>
      (
        functionCallOf(format(results.map((result, at) => ({ key: `k${at}`, result }))))
          .arguments as { verdict: string }
      ).verdict;

    expect(verdictOf(["met", "inconclusive", "unmet"])).toBe("failure");
    expect(verdictOf(["met", "inconclusive"])).toBe("inconclusive");
    expect(verdictOf(["met", "met"])).toBe("success");
  });

  /** @scenario "A verdict with no explanation lists its criteria, naming no backend" */
  it("lists the criteria by result when the answer carries no reasoning", () => {
    const completion = format([
      { key: "the_agent_offers_a_refund", result: "met" },
      { key: "the_agent_apologises", result: "unmet" },
    ]);

    expect((functionCallOf(completion).arguments as { reasoning: string }).reasoning).toBe(
      "Met: The agent offers a refund\nNot met: The agent apologises",
    );
  });

  /** @scenario "A turn decision is answered as the tool the judge offered" */
  it("answers a decision as continue_test or make_verdict with no arguments", () => {
    const decide = (decision: "continue" | "verdict") =>
      functionCallOf(
        judgePreviewChatCompletionOf({
          answer: { outcome: "judged", phase: "decision", decision, inputTokens: 10, priceUsd: 0 },
          call: judgePreviewLeafCallOf(decisionRequest()),
          id: "chatcmpl_2",
          createdAtSeconds: 1,
        }),
      );

    expect(decide("continue")).toEqual({ name: "continue_test", arguments: {} });
    expect(decide("verdict")).toEqual({ name: "make_verdict", arguments: {} });
  });
});
