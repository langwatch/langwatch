import type { TraceRecord } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { DatasetTraceMapperService } from "../dataset-trace-mapper.service.ts";

/**
 * Chat messages as AI SDK UI messages store them: `parts` that carry no `text`
 * (`step-start`) or that name the tool in the type (`tool-<name>`). The strict
 * span shape has no branch for them, and the previous release never parsed it.
 */
const uiMessagesInput = {
  type: "chat_messages",
  value: [
    { role: "system", content: "You are a weather bot" },
    {
      role: "user",
      parts: [{ type: "step-start" }, { type: "text", text: "Weather in Lisbon?" }],
    },
  ],
};
const uiMessagesOutput = {
  type: "chat_messages",
  value: [
    {
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "Checking." },
        {
          type: "tool-getWeather",
          toolCallId: "call-1",
          state: "output-available",
          input: { city: "Lisbon" },
          output: { celsius: 21 },
        },
      ],
    },
  ],
};

const span = (overrides: Record<string, unknown>) => ({
  span_id: "span-1",
  trace_id: "trace-1",
  type: "llm",
  model: "gpt-5-mini",
  timestamps: { started_at: 1, finished_at: 2 },
  ...overrides,
});

const trace = (spans: Record<string, unknown>[]): TraceRecord => ({
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 2, updated_at: 3 },
  input: { value: "Weather in Lisbon?" },
  output: { value: "Checking." },
  spans: spans as TraceRecord["spans"],
});

const mapper = DatasetTraceMapperService.create();

describe("DatasetTraceMapperService", () => {
  describe("when a stored LLM span carries chat message parts the strict span shape rejects", () => {
    const stored = trace([
      span({ input: uiMessagesInput, output: uiMessagesOutput }),
      span({ span_id: "span-2", type: "rag", contexts: [], input: uiMessagesInput }),
    ]);

    it("maps the span input and output to dataset columns unchanged", () => {
      const rows = mapper.map({
        trace: stored,
        mapping: {
          input: { source: "spans.llm.input" },
          output: { source: "spans.llm.output" },
        },
        expansions: [],
      });

      expect(rows).toEqual([
        {
          input: JSON.stringify([uiMessagesInput.value]),
          output: JSON.stringify([uiMessagesOutput.value]),
        },
      ]);
    });

    it("keeps the full span's input value when a column maps whole spans", () => {
      const [row] = mapper.map({
        trace: stored,
        mapping: { spans: { source: "spans", key: "*", subkey: "input" } },
        expansions: [],
      });

      expect(JSON.parse(String(row?.spans))).toEqual([
        { type: "json", value: uiMessagesInput.value },
        { type: "json", value: uiMessagesInput.value },
      ]);
    });
  });

  describe("when a stored span input is a well-formed typed value", () => {
    it("passes it through with its type", () => {
      const input = {
        type: "chat_messages",
        value: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      };
      const [row] = mapper.map({
        trace: trace([span({ input, output: { type: "text", value: "hello" } })]),
        mapping: { spans: { source: "spans", key: "*", subkey: "input" } },
        expansions: [],
      });

      expect(JSON.parse(String(row?.spans))).toEqual([input]);
    });
  });

  describe("when a stored span input is not a typed value at all", () => {
    it("carries the bare value as json", () => {
      const rows = mapper.map({
        trace: trace([span({ input: ["a", "b"], output: null })]),
        mapping: { input: { source: "spans.llm.input" } },
        expansions: [],
      });

      expect(rows).toEqual([{ input: JSON.stringify([["a", "b"]]) }]);
    });
  });
});
