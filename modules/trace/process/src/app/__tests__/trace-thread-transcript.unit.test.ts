import { createApiFixture } from "@langwatch/api-fixture";
import type { ChatMessage, Span, Trace, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

function createTraceApp(): TraceApi {
  return TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

const chatSpan = ({ input, output }: { input: ChatMessage[]; output: ChatMessage[] }): Span => ({
  trace_id: "trace-1",
  span_id: "llm-1",
  type: "llm",
  model: "gpt-4o",
  timestamps: { started_at: 1_700_000_000_000, finished_at: 1_700_000_001_000 },
  input: { type: "chat_messages", value: input },
  output: { type: "chat_messages", value: output },
});

const trace = ({ spans = [], metadata = {}, ...overrides }: Partial<Trace> = {}): Trace => ({
  trace_id: "trace-1",
  project_id: "project-1",
  metadata,
  timestamps: {
    started_at: 1_700_000_000_000,
    inserted_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
  },
  metrics: { total_time_ms: 1_000, total_cost: 0.01, prompt_tokens: 60, completion_tokens: 40 },
  spans,
  ...overrides,
});

describe("TraceApi.renderThreadTranscript", () => {
  describe("given a thread of traces that recorded their own text", () => {
    it("renders the conversation heading and every turn in the order given", async () => {
      const transcript = await createTraceApp().renderThreadTranscript({
        threadKey: "thread-7",
        traces: [
          trace({
            trace_id: "trace-1",
            input: { value: "what is the capital of France?" },
            output: { value: "Paris" },
          }),
          trace({
            trace_id: "trace-2",
            timestamps: {
              started_at: 1_700_000_060_000,
              inserted_at: 1_700_000_060_000,
              updated_at: 1_700_000_060_000,
            },
            input: { value: "and of Spain?" },
            output: { value: "Madrid" },
          }),
        ],
      });

      expect(transcript).toContain("# Conversation `thread-7`");
      expect(transcript).toContain("- **Turns:** 2");
      expect(transcript.indexOf("Paris")).toBeLessThan(transcript.indexOf("Madrid"));
    });
  });

  describe("given a turn whose own output was never captured", () => {
    /** @scenario "A turn with no computed content falls back to the trace's LLM span messages" */
    it("reads the reply from the trace's chosen LLM span", async () => {
      const transcript = await createTraceApp().renderThreadTranscript({
        threadKey: "thread-7",
        traces: [
          trace({
            input: { value: "" },
            output: { value: "" },
            spans: [
              chatSpan({
                input: [{ role: "user", content: "who won the match?" }],
                output: [{ role: "assistant", content: "the home side, 2-1" }],
              }),
            ],
          }),
        ],
      });

      expect(transcript).toContain("who won the match?");
      expect(transcript).toContain("the home side, 2-1");
    });
  });

  describe("given a budget smaller than the thread", () => {
    it("cuts the transcript and names what it dropped", async () => {
      const traces = Array.from({ length: 30 }, (_, index) =>
        trace({
          trace_id: `trace-${index}`,
          timestamps: {
            started_at: 1_700_000_000_000 + index * 1_000,
            inserted_at: 1_700_000_000_000 + index * 1_000,
            updated_at: 1_700_000_000_000 + index * 1_000,
          },
          input: { value: `question ${index} ${"padding ".repeat(40)}` },
          output: { value: `answer ${index} ${"padding ".repeat(40)}` },
        }),
      );

      const transcript = await createTraceApp().renderThreadTranscript({
        threadKey: "thread-7",
        traces,
        maxTokens: 600,
      });

      expect(transcript).toContain("omitted to fit the token budget");
      expect(transcript).toContain("question 0");
      expect(transcript).toContain("question 29");
    });
  });
});
