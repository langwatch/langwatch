import type { ChatMessage, Span, SpanInputOutput } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  extractLlmMessagesForSpan,
  extractLlmMessagesForTrace,
  pickLlmSpanForTrace,
} from "../trace-llm-messages.rules.ts";

const timestamps = { started_at: 1_700_000_000_000, finished_at: 1_700_000_001_000 };

const span = ({
  spanId,
  type = "span",
  input,
  output,
}: {
  spanId: string;
  type?: Span["type"];
  input?: SpanInputOutput;
  output?: SpanInputOutput;
}): Span => ({
  trace_id: "trace-1",
  span_id: spanId,
  type,
  timestamps,
  ...(input ? { input } : {}),
  ...(output ? { output } : {}),
});

const chatSpan = ({
  spanId,
  input,
  output,
}: {
  spanId: string;
  input: ChatMessage[];
  output?: ChatMessage[];
}): Span =>
  span({
    spanId,
    type: "llm",
    input: { type: "chat_messages", value: input },
    ...(output ? { output: { type: "chat_messages", value: output } } : {}),
  });

describe("pickLlmSpanForTrace", () => {
  describe("given a trace with several LLM spans", () => {
    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("picks the last LLM span whose input reads as chat messages", () => {
      const chosen = pickLlmSpanForTrace({
        spans: [
          chatSpan({ spanId: "first", input: [{ role: "user", content: "a" }] }),
          chatSpan({ spanId: "last", input: [{ role: "user", content: "b" }] }),
        ],
      });

      expect(chosen?.span_id).toBe("last");
    });

    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("skips an LLM span whose input is a bare string", () => {
      const chosen = pickLlmSpanForTrace({
        spans: [
          chatSpan({ spanId: "chat", input: [{ role: "user", content: "a" }] }),
          span({
            spanId: "prompt-template",
            type: "llm",
            input: { type: "text", value: "Answer the question." },
          }),
        ],
      });

      expect(chosen?.span_id).toBe("chat");
    });

    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("never picks a span that is not an LLM call", () => {
      const chosen = pickLlmSpanForTrace({
        spans: [
          chatSpan({ spanId: "chat", input: [{ role: "user", content: "a" }] }),
          span({
            spanId: "http",
            type: "client",
            input: { type: "chat_messages", value: [{ role: "user", content: "b" }] },
          }),
        ],
      });

      expect(chosen?.span_id).toBe("chat");
    });
  });

  describe("given a trace with no chat-shaped LLM span", () => {
    it("returns nothing", () => {
      expect(pickLlmSpanForTrace({ spans: [span({ spanId: "one" })] })).toBeNull();
    });
  });
});

describe("extractLlmMessagesForTrace", () => {
  describe("given a chosen LLM span", () => {
    /** @scenario "The last LLM span whose input reads as a conversation wins" */
    it("splits its messages the way the drawer's panels split them", () => {
      const result = extractLlmMessagesForTrace({
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
      const result = extractLlmMessagesForTrace({
        trace: {},
        spans: [
          span({
            spanId: "llm",
            type: "llm",
            input: { type: "chat_messages", value: [{ role: "user", content: "hello" }] },
            output: { type: "text", value: "plain reply" },
          }),
        ],
      });

      expect(result?.output).toEqual([{ role: "assistant", content: "plain reply" }]);
    });
  });

  describe("given a trace whose spans carry no chat-shaped LLM input", () => {
    /** @scenario "A trace with no chat-shaped LLM span falls back to its own text" */
    it("falls back to the trace's own primary input and output", () => {
      const result = extractLlmMessagesForTrace({
        trace: { input: { value: "what is the weather" }, output: { value: "it is raining" } },
        spans: [span({ spanId: "one" })],
      });

      expect(result?.input).toEqual([{ role: "user", content: "what is the weather" }]);
      expect(result?.output).toEqual([{ role: "assistant", content: "it is raining" }]);
    });

    /** @scenario "A trace with no chat-shaped LLM span falls back to its own text" */
    it("reads a chat-shaped trace input as the conversation it is", () => {
      const result = extractLlmMessagesForTrace({
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
      expect(extractLlmMessagesForTrace({ trace: {}, spans: [] })).toBeNull();
    });
  });
});

describe("extractLlmMessagesForSpan", () => {
  describe("given an LLM span whose system prompt canonicalisation moved to gen_ai.system_instructions", () => {
    const withInstructions = (input: ChatMessage[]): Span => ({
      ...chatSpan({
        spanId: "llm",
        input,
        output: [{ role: "assistant", content: "Sure." }],
      }),
      params: { gen_ai: { system_instructions: "You are ACME's support agent." } },
    });

    /** @scenario "An LLM span's messages include its system prompt" */
    it("starts the input side with that system prompt", () => {
      const messages = extractLlmMessagesForSpan({
        span: withInstructions([{ role: "user", content: "Refund me" }]),
      });

      expect(messages.input).toEqual([
        { role: "system", content: "You are ACME's support agent." },
        { role: "user", content: "Refund me" },
      ]);
      expect(messages.output).toEqual([{ role: "assistant", content: "Sure." }]);
    });

    /** @scenario "An LLM span's messages include its system prompt" */
    it("does not add a second system message to an input that carries one", () => {
      const messages = extractLlmMessagesForSpan({
        span: withInstructions([
          { role: "system", content: "Inline prompt" },
          { role: "user", content: "Refund me" },
        ]),
      });

      expect(messages.input.filter((message) => message.role === "system")).toEqual([
        { role: "system", content: "Inline prompt" },
      ]);
    });
  });
});
