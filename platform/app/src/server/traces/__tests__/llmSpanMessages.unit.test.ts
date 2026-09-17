import { describe, expect, it } from "vitest";
import type { Span } from "../../tracer/types";
import { chooseLlmSpanForTrace, llmMessagesForTrace } from "../llmSpanMessages";

const timestamps = {
  started_at: 1_700_000_000_000,
  finished_at: 1_700_000_001_000,
};

const span = (overrides: Partial<Span> & { span_id: string }): Span =>
  ({
    trace_id: "trace-1",
    type: "span",
    timestamps,
    ...overrides,
  }) as Span;

type TestChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const chatSpan = ({
  spanId,
  input,
  output,
}: {
  spanId: string;
  input: TestChatMessage[];
  output?: TestChatMessage[];
}): Span =>
  span({
    span_id: spanId,
    type: "llm",
    input: { type: "chat_messages", value: input },
    ...(output ? { output: { type: "chat_messages", value: output } } : {}),
  });

describe("chooseLlmSpanForTrace", () => {
  describe("given a trace with several LLM spans", () => {
    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("picks the last LLM span whose input reads as chat messages", () => {
      const chosen = chooseLlmSpanForTrace({
        spans: [
          chatSpan({
            spanId: "first",
            input: [{ role: "user", content: "a" }],
          }),
          chatSpan({ spanId: "last", input: [{ role: "user", content: "b" }] }),
        ],
      });
      expect(chosen?.span_id).toBe("last");
    });

    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("skips an LLM span whose input is a bare string", () => {
      const chosen = chooseLlmSpanForTrace({
        spans: [
          chatSpan({ spanId: "chat", input: [{ role: "user", content: "a" }] }),
          span({
            span_id: "prompt-template",
            type: "llm",
            input: { type: "text", value: "Answer the question." },
          }),
        ],
      });
      expect(chosen?.span_id).toBe("chat");
    });

    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("never picks a span that is not an LLM call", () => {
      const chosen = chooseLlmSpanForTrace({
        spans: [
          chatSpan({ spanId: "chat", input: [{ role: "user", content: "a" }] }),
          span({
            span_id: "http",
            type: "client",
            input: {
              type: "chat_messages",
              value: [{ role: "user", content: "b" }],
            },
          }),
        ],
      });
      expect(chosen?.span_id).toBe("chat");
    });
  });

  describe("given a trace with no chat-shaped LLM span", () => {
    it("returns nothing", () => {
      expect(
        chooseLlmSpanForTrace({
          spans: [span({ span_id: "one", type: "span" })],
        }),
      ).toBeNull();
    });
  });
});

describe("llmMessagesForTrace", () => {
  describe("given a chosen LLM span", () => {
    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("splits its messages the way the drawer's panels split them", () => {
      const result = llmMessagesForTrace({
        trace: {},
        spans: [
          chatSpan({
            spanId: "llm",
            input: [
              { role: "user", content: "hello" },
              { role: "assistant", content: "hi" },
            ],
            output: [{ role: "assistant", content: "hi" }],
          }),
        ],
      });
      // The trailing assistant message belongs to the output panel.
      expect(result?.input).toEqual([{ role: "user", content: "hello" }]);
      expect(result?.output).toEqual([{ role: "assistant", content: "hi" }]);
    });

    it("wraps a non-chat output as one assistant message", () => {
      const result = llmMessagesForTrace({
        trace: {},
        spans: [
          span({
            span_id: "llm",
            type: "llm",
            input: {
              type: "chat_messages",
              value: [{ role: "user", content: "hello" }],
            },
            output: { type: "text", value: "plain reply" },
          }),
        ],
      });
      expect(result?.output).toEqual([
        { role: "assistant", content: "plain reply" },
      ]);
    });
  });

  describe("given a trace whose spans carry no chat-shaped LLM input", () => {
    /** @scenario "A trace with no chat-shaped LLM span falls back to its own text" */
    it("falls back to the trace's own primary input and output", () => {
      const result = llmMessagesForTrace({
        trace: {
          input: { value: "what is the weather" },
          output: { value: "it is raining" },
        },
        spans: [span({ span_id: "one", type: "span" })],
      });
      expect(result?.input).toEqual([
        { role: "user", content: "what is the weather" },
      ]);
      expect(result?.output).toEqual([
        { role: "assistant", content: "it is raining" },
      ]);
    });

    /** @scenario "A trace with no chat-shaped LLM span falls back to its own text" */
    it("reads a chat-shaped trace input as the conversation it is", () => {
      const result = llmMessagesForTrace({
        trace: {
          input: {
            value: JSON.stringify([
              { role: "system", content: "be brief" },
              { role: "user", content: "hello" },
            ]),
          },
          output: { value: "hi" },
        },
        spans: [],
      });
      expect(result?.input).toEqual([
        { role: "system", content: "be brief" },
        { role: "user", content: "hello" },
      ]);
    });
  });

  describe("given a trace with nothing to read", () => {
    /** @scenario "A trace with nothing to read returns nothing" */
    it("returns nothing", () => {
      expect(llmMessagesForTrace({ trace: {}, spans: [] })).toBeNull();
    });
  });
});
