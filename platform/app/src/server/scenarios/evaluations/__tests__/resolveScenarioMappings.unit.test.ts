import { describe, expect, it } from "vitest";
import type { Span } from "~/server/tracer/types";
import type { EvaluatorAttachment } from "../../evaluator-attachments";
import { MAX_STORED_INPUT_LENGTH } from "../constants";
import {
  attachmentsReadTrace,
  type ConversationMessage,
  resolveAttachmentInputs,
  resolveConversationMapping,
  resolveScenarioMapping,
  resolveTraceMapping,
  type ScenarioInputs,
  storedInputsOf,
  toolNameOf,
} from "../resolveScenarioMappings";

const messages: ConversationMessage[] = [
  { role: "user", content: "How many refunds last quarter?" },
  { role: "assistant", content: "Let me check." },
  { role: "user", content: "Please do." },
  { role: "assistant", content: "There were 12 refunds." },
];

const scenario: ScenarioInputs = {
  situation: "A fraud analyst asks for chargebacks per quarter.",
  criteria: ["The agent runs a query", "The agent answers with a number"],
  fields: { golden_sql: "SELECT count(*) FROM refunds", max_rows: 10 },
};

function span(overrides: Partial<Span> & { type: Span["type"] }): Span {
  return {
    span_id: `span-${Math.random().toString(36).slice(2, 8)}`,
    parent_id: null,
    trace_id: "trace-1",
    name: "span",
    input: null,
    output: null,
    error: null,
    timestamps: { started_at: 1_000, finished_at: 2_000, first_token_at: null },
    metrics: null,
    params: null,
    ...overrides,
  } as Span;
}

const toolCall = ({
  startedAt,
  input,
  output,
  name = "run_sql",
}: {
  startedAt: number;
  input: string;
  output: string;
  name?: string;
}): Span =>
  span({
    type: "tool",
    name: "tool",
    params: { gen_ai: { tool: { name } } },
    input: { type: "json", value: { sql: input } },
    output: { type: "text", value: output },
    timestamps: {
      started_at: startedAt,
      finished_at: startedAt + 10,
      first_token_at: null,
    },
  });

const ragSpan = (contents: string[]): Span =>
  span({
    type: "rag",
    contexts: contents.map((content, index) => ({
      document_id: `doc-${index}`,
      chunk_id: null,
      content,
    })),
  } as Partial<Span> & { type: "rag" });

describe("resolveConversationMapping", () => {
  describe("given a run with two user turns and two agent turns", () => {
    /** @scenario "Conversation mappings read the messages of the run" */
    it("reads the first user message, the last agent message, the transcript and the messages", () => {
      const read = (path: string) =>
        resolveConversationMapping({ path: [path], messages });

      expect(read("first_user_message")).toEqual({
        kind: "value",
        value: "How many refunds last quarter?",
      });
      expect(read("last_agent_message")).toEqual({
        kind: "value",
        value: "There were 12 refunds.",
      });
      expect(read("transcript")).toEqual({
        kind: "value",
        value: [
          "user: How many refunds last quarter?",
          "assistant: Let me check.",
          "user: Please do.",
          "assistant: There were 12 refunds.",
        ].join("\n"),
      });
      expect(read("messages")).toEqual({
        kind: "value",
        value: JSON.stringify(messages),
      });
    });
  });

  describe("when the conversation has no agent turn", () => {
    it("fails with a reason", () => {
      expect(
        resolveConversationMapping({
          path: ["last_agent_message"],
          messages: [{ role: "user", content: "Hello" }],
        }),
      ).toEqual({
        kind: "failed",
        details: "no agent message in the conversation",
      });
    });
  });
});

describe("resolveScenarioMapping", () => {
  describe("given a scenario with a situation, two criteria and a field", () => {
    /** @scenario "Scenario mappings read the situation, the criteria and a field" */
    it("reads the situation, the criteria joined by a newline and the field as text", () => {
      expect(resolveScenarioMapping({ path: ["situation"], scenario })).toEqual(
        { kind: "value", value: scenario.situation },
      );
      expect(resolveScenarioMapping({ path: ["criteria"], scenario })).toEqual({
        kind: "value",
        value: "The agent runs a query\nThe agent answers with a number",
      });
      expect(
        resolveScenarioMapping({ path: ["fields", "max_rows"], scenario }),
      ).toEqual({ kind: "value", value: "10" });
    });
  });

  describe("when the scenario carries no value for the field", () => {
    /** @scenario "A blank scenario field skips the evaluator with a reason" */
    it("skips with the field named in the reason", () => {
      expect(
        resolveScenarioMapping({
          path: ["fields", "golden_sql"],
          scenario: { ...scenario, fields: { golden_sql: "   " } },
        }),
      ).toEqual({ kind: "skipped", details: "no golden_sql on this scenario" });
      expect(
        resolveScenarioMapping({
          path: ["fields", "table_schema"],
          scenario,
        }),
      ).toEqual({
        kind: "skipped",
        details: "no table_schema on this scenario",
      });
    });
  });
});

describe("resolveTraceMapping", () => {
  describe("given two run_sql calls and one rag span", () => {
    const spans = [
      toolCall({ startedAt: 1_000, input: "SELECT 1", output: "1" }),
      ragSpan(["refunds(id, amount)", "orders(id)"]),
      toolCall({ startedAt: 3_000, input: "SELECT 2", output: "2" }),
      toolCall({
        startedAt: 2_000,
        input: "SELECT 0",
        output: "0",
        name: "other",
      }),
    ];
    const read = (path: string[]) =>
      resolveTraceMapping({ path, spans, hasTraces: true });

    /** @scenario "Trace mappings read tool calls and retrieved contexts" */
    it("reads the last run_sql call's input and output, and every context", () => {
      expect(read(["tool_calls", "run_sql", "input"])).toEqual({
        kind: "value",
        value: JSON.stringify({ sql: "SELECT 2" }),
      });
      expect(read(["tool_calls", "run_sql", "output"])).toEqual({
        kind: "value",
        value: "2",
      });
      expect(read(["contexts"])).toEqual({
        kind: "value",
        value: ["refunds(id, amount)", "orders(id)"],
      });
    });

    it("names a tool by its gen_ai.tool.name attribute, else by the span name", () => {
      expect(toolNameOf(spans[0]!)).toBe("run_sql");
      expect(toolNameOf(span({ type: "tool", name: "lookup" }))).toBe("lookup");
    });
  });

  describe("when the run has traces but their spans have not arrived", () => {
    /** @scenario "Trace data that has not arrived yet is retried with a growing delay" */
    it("reports the value as pending", () => {
      expect(
        resolveTraceMapping({
          path: ["tool_calls", "run_sql", "input"],
          spans: [],
          hasTraces: true,
        }),
      ).toEqual({ kind: "pending", details: "no run_sql call in the trace" });
      expect(
        resolveTraceMapping({ path: ["contexts"], spans: [], hasTraces: true }),
      ).toEqual({
        kind: "pending",
        details: "no retrieved contexts in the trace",
      });
    });
  });

  describe("when the spans arrived and hold no such call", () => {
    /** @scenario "A tool call the trace does not hold fails the evaluator with a reason" */
    it("fails with the tool named in the reason", () => {
      expect(
        resolveTraceMapping({
          path: ["tool_calls", "run_sql", "input"],
          spans: [
            toolCall({ startedAt: 1, input: "x", output: "y", name: "other" }),
          ],
          hasTraces: true,
        }),
      ).toEqual({ kind: "failed", details: "no run_sql call in the trace" });
    });
  });

  describe("when the run produced no trace at all", () => {
    /** @scenario "Retrieved contexts the trace does not hold fail the evaluator with a reason" */
    it("fails right away instead of waiting", () => {
      expect(
        resolveTraceMapping({
          path: ["contexts"],
          spans: [],
          hasTraces: false,
        }),
      ).toEqual({
        kind: "failed",
        details: "no retrieved contexts in the trace",
      });
    });
  });
});

describe("resolveAttachmentInputs", () => {
  const inputs = [
    { id: "output", required: true },
    { id: "expected_output", required: true },
    { id: "input", required: false },
  ];
  const run = { messages, spans: [], hasTraces: false };

  describe("given mappings to the conversation, a field and a literal", () => {
    /** @scenario "A literal mapping reads its value" */
    it("resolves every mapped input and leaves an unmapped optional one out", () => {
      const attachment: Pick<EvaluatorAttachment, "mappings"> = {
        mappings: {
          output: {
            type: "source",
            sourceId: "conversation",
            path: ["last_agent_message"],
          },
          expected_output: { type: "value", value: "42" },
        },
      };
      expect(
        resolveAttachmentInputs({ attachment, inputs, run, scenario }),
      ).toEqual({
        kind: "ready",
        data: { output: "There were 12 refunds.", expected_output: "42" },
      });
    });
  });

  describe("when a required input has no mapping", () => {
    it("skips with the input named", () => {
      expect(
        resolveAttachmentInputs({
          attachment: { mappings: {} },
          inputs,
          run,
          scenario,
        }),
      ).toEqual({ kind: "skipped", details: "no mapping for output" });
    });
  });

  describe("when a field is blank and the trace has not arrived", () => {
    it("skips instead of waiting for the trace", () => {
      expect(
        resolveAttachmentInputs({
          attachment: {
            mappings: {
              output: {
                type: "source",
                sourceId: "trace",
                path: ["tool_calls", "run_sql", "input"],
              },
              expected_output: {
                type: "source",
                sourceId: "scenario",
                path: ["fields", "table_schema"],
              },
            },
          },
          inputs,
          run: { ...run, hasTraces: true },
          scenario,
        }),
      ).toEqual({
        kind: "skipped",
        details: "no table_schema on this scenario",
      });
    });
  });

  it("says whether any attachment reads the trace", () => {
    expect(
      attachmentsReadTrace([
        {
          mappings: {
            contexts: { type: "source", sourceId: "trace", path: ["contexts"] },
          },
        },
      ]),
    ).toBe(true);
    expect(
      attachmentsReadTrace([
        { mappings: { output: { type: "value", value: "x" } } },
      ]),
    ).toBe(false);
  });
});

describe("storedInputsOf", () => {
  describe("given an input longer than the stored cap and a list input", () => {
    /** @scenario "Stored inputs are cut to two thousand characters" */
    it("cuts the text and joins the list", () => {
      const long = "x".repeat(MAX_STORED_INPUT_LENGTH + 500);
      const stored = storedInputsOf({ output: long, contexts: ["a", "b"] });
      expect(stored.output).toHaveLength(MAX_STORED_INPUT_LENGTH);
      expect(stored.contexts).toBe("a\nb");
    });
  });
});
