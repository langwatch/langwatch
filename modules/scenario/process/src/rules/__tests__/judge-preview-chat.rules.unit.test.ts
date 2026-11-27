/**
 * The scenario judge's chat call read as a judge-leaf call, and the leaf's answer formatted as
 * the tool call the judge reads. The requests are the ones the scenario SDK's judge sends.
 * @see modules/scenario/specs/judge-preview.feature
 */
import { JudgePreviewRequestInvalidError } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  decisionRequest,
  sdkVerdictRequestFor,
  verdictRequest,
} from "../../__tests__/support/judge-preview-requests.fixture.ts";
import {
  isJudgePreviewWaitOffered,
  judgePreviewChatCompletionOf,
  judgePreviewLeafCallOf,
  judgePreviewWaitCompletionOf,
} from "../judge-preview-chat.rules.ts";

type JsonSchema = Readonly<{
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  enum?: readonly unknown[];
  additionalProperties?: boolean;
}>;

/** The keys and enums of the SDK's strict tool, checked the way the AI SDK validates its input. */
function strictViolationsOf({ value, schema }: { value: unknown; schema: JsonSchema }): string[] {
  if (schema.enum) return schema.enum.includes(value) ? [] : [`${String(value)} not offered`];
  if (!schema.properties) return [];
  if (typeof value !== "object" || value === null) return ["not an object"];
  const entries = Object.entries(value);
  const extra = entries.filter(([key]) => !schema.properties?.[key]).map(([key]) => `+${key}`);
  const missing = (schema.required ?? []).filter((key) => !(key in value)).map((key) => `-${key}`);
  const nested = entries.flatMap(([key, inner]) =>
    schema.properties?.[key]
      ? strictViolationsOf({ value: inner, schema: schema.properties[key] })
      : [],
  );
  return [...extra, ...missing, ...nested];
}

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

    /** @scenario "A criterion's text falls back to its description without the Criterion number, then to its key" */
    it("takes a description less its Criterion number, else the key, when the block does not list one per key", () => {
      const request = verdictRequest({ system: "<criteria>\n1. Only one listed\n</criteria>" });
      const [finishTest] = request.tools ?? [];
      const parameters = finishTest!.function.parameters as {
        properties: { criteria: { properties: Record<string, Record<string, unknown>> } };
      };
      const entries = parameters.properties.criteria.properties;
      const call = judgePreviewLeafCallOf({
        ...request,
        tools: [
          {
            ...finishTest!,
            function: {
              ...finishTest!.function,
              parameters: {
                ...parameters,
                properties: {
                  ...parameters.properties,
                  criteria: {
                    ...parameters.properties.criteria,
                    properties: {
                      the_agent_offers_a_refund: {
                        ...entries.the_agent_offers_a_refund,
                        description: "Criterion 1: The agent offers a refund",
                      },
                      the_agent_apologises: entries.the_agent_apologises!,
                    },
                  },
                },
              },
            },
          },
        ],
      });

      expect(call.criteria).toEqual([
        { key: "the_agent_offers_a_refund", text: "The agent offers a refund" },
        { key: "the_agent_apologises", text: "the_agent_apologises" },
      ]);
    });

    describe('when a criterion holds a line end, as the SDK joins its criteria with "\\n"', () => {
      /** @scenario "A criterion written over several lines keeps its wording, and so do the others" */
      it.each([
        ["\\n", "\n"],
        ["\\r\\n", "\r\n"],
        ["a lone \\r", "\r"],
      ])("reads every criterion's wording when one holds %s", (_name, lineEnd) => {
        const call = judgePreviewLeafCallOf(
          sdkVerdictRequestFor([
            `The agent offers a refund${lineEnd}- in the first reply`,
            "The agent apologises",
            "The agent names the order",
          ]),
        );

        expect(call.criteria.map((criterion) => criterion.text)).toEqual([
          "The agent offers a refund\n- in the first reply",
          "The agent apologises",
          "The agent names the order",
        ]);
        expect(call.criteria[0]?.key).toMatch(/^the_agent_offers_a_refund_+in_the_first_reply$/);
      });

      /** @scenario "A criterion written over several lines keeps its wording, and so do the others" */
      it("keeps the end of a criterion longer than its 70-character key", () => {
        const long =
          "The agent explains the refund policy for orders that arrived more than ten days late\nand names the form";
        const call = judgePreviewLeafCallOf(sdkVerdictRequestFor(["The agent apologises", long]));

        expect(call.criteria.map((criterion) => criterion.text)).toEqual([
          "The agent apologises",
          long,
        ]);
        expect(call.criteria[1]?.key).toHaveLength(70);
      });

      /** @scenario "A criterion written over several lines keeps its wording, and so do the others" */
      it("reads a criteria block with \\r\\n line ends as one with \\n", () => {
        const request = sdkVerdictRequestFor(["The agent offers a refund", "The agent apologises"]);
        const [system, ...rest] = request.messages;
        const prompt = system!.content;
        if (typeof prompt !== "string") throw new Error("the SDK's system prompt is plain text");
        const call = judgePreviewLeafCallOf({
          ...request,
          messages: [{ ...system!, content: prompt.replace(/\n/g, "\r\n") }, ...rest],
        });

        expect(call.criteria.map((criterion) => criterion.text)).toEqual([
          "The agent offers a refund",
          "The agent apologises",
        ]);
      });
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
          the_agent_offers_a_refund: {
            requirement: "The agent offers a refund",
            reasoning: "Met.",
            status: "passed",
          },
          the_agent_apologises: {
            requirement: "The agent apologises",
            reasoning: "Not met.",
            status: "failed",
          },
        },
        reasoning: "The agent refunded the order and never apologised.",
      },
    });
  });

  /** @scenario "A verdict is answered as the judge's finish_test tool call" */
  it("answers an unsettled criterion as inconclusive", () => {
    const completion = format([
      { key: "the_agent_offers_a_refund", result: "inconclusive" },
      { key: "the_agent_apologises", result: "met" },
    ]);

    const { criteria } = functionCallOf(completion).arguments as {
      criteria: Record<string, { status: string }>;
    };
    expect(criteria.the_agent_offers_a_refund?.status).toBe("inconclusive");
  });

  /** @scenario "The verdict's arguments fit the scenario SDK's strict finish_test tool" */
  it.each([
    ["met", "unmet"],
    ["met", "inconclusive"],
    ["met", "met"],
  ] as const)(
    "fits the SDK's strict tool for %s and %s, with no verdict field",
    (first, second) => {
      const completion = format(
        [
          { key: "the_agent_offers_a_refund", result: first },
          { key: "the_agent_apologises", result: second },
        ],
        "summary",
      );
      const schema = verdictRequest().tools?.[0]?.function.parameters as JsonSchema;

      expect(strictViolationsOf({ value: functionCallOf(completion).arguments, schema })).toEqual(
        [],
      );
    },
  );

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

  /** @scenario "A verdict call that offers the one-shot wait for traces is answered with that wait" */
  it("answers a verdict call offering wait_for_traces with that wait, billing nothing", () => {
    const request = verdictRequest({ extraTools: ["wait_for_traces"] });
    const wait = judgePreviewWaitCompletionOf({ id: "chatcmpl_3", createdAtSeconds: 1 });

    expect(isJudgePreviewWaitOffered(request)).toBe(true);
    expect(functionCallOf(wait)).toEqual({ name: "wait_for_traces", arguments: {} });
    expect(wait.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  /** @scenario "A verdict call that offers the one-shot wait for traces is answered with that wait" */
  it("answers no wait when the call does not offer one", () => {
    expect(isJudgePreviewWaitOffered(verdictRequest())).toBe(false);
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
