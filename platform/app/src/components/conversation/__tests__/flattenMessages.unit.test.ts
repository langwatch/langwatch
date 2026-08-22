/**
 * Spec: specs/prompts/playground-conversation.feature
 */
import { describe, expect, it } from "vitest";
import {
  type FlattenableMessage,
  flattenMessages,
  groupIntoTurns,
} from "../flattenMessages";
import type { DisplayPart } from "../types";

const message = (msg: Record<string, unknown>) => msg as FlattenableMessage;

const flatten = (messages: Record<string, unknown>[]) =>
  flattenMessages({ messages: messages.map(message) });

describe("flattenMessages", () => {
  describe("given tool calls on the message", () => {
    const call = {
      id: "call_1",
      function: { name: "search", arguments: '{"q":"weather"}' },
    };

    /** @scenario "Tool calls are recognised in both wire casings" */
    it("reads both wire casings the same way", () => {
      const snake = flatten([
        { id: "m1", role: "assistant", content: "", tool_calls: [call] },
      ]);
      const camel = flatten([
        { id: "m1", role: "assistant", content: "", toolCalls: [call] },
      ]);

      expect(snake).toEqual(camel);
      expect(snake).toHaveLength(1);
      expect(snake[0]).toMatchObject({
        kind: "tool",
        name: "search",
        arguments: { q: "weather" },
      });
    });

    it("keeps unparseable arguments rather than dropping the call", () => {
      const [part] = flatten([
        {
          id: "m1",
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "c", function: { name: "search", arguments: "not json" } },
          ],
        },
      ]);

      expect(part).toMatchObject({ kind: "tool", name: "search" });
    });
  });

  describe("given a tool result in a later message", () => {
    it("pairs it onto the call it answers", () => {
      const parts = flatten([
        {
          id: "m1",
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", function: { name: "search", arguments: "{}" } },
          ],
        },
        {
          id: "m2",
          role: "tool",
          tool_call_id: "call_1",
          content: '{"hits":3}',
        },
      ]);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        kind: "tool",
        name: "search",
        result: { content: { hits: 3 } },
      });
    });

    it("keeps a result whose call is not in the transcript", () => {
      const parts = flatten([
        { id: "m2", role: "tool", tool_call_id: "orphan", content: "done" },
      ]);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ kind: "tool" });
    });
  });

  describe("given typed content blocks", () => {
    /** @scenario "Typed content blocks are flattened into parts" */
    it("produces a text part and a tool part in source order", () => {
      const parts = flatten([
        {
          id: "m1",
          role: "assistant",
          content: [
            { type: "text", text: "Let me look that up." },
            { type: "tool_use", id: "tu_1", name: "search", input: { q: "x" } },
          ],
        },
      ]);

      expect(parts.map((part) => part.kind)).toEqual(["text", "tool"]);
      expect(parts[1]).toMatchObject({ name: "search", arguments: { q: "x" } });
    });

    it("pairs an Anthropic tool_result onto its tool_use", () => {
      const parts = flatten([
        {
          id: "m1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
        {
          id: "m2",
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: "file contents",
              is_error: true,
            },
          ],
        },
      ]);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        kind: "tool",
        name: "read",
        result: { content: "file contents", isError: true },
      });
    });
  });

  describe("given reasoning alongside a reply", () => {
    it.each([
      ["reasoning_content"],
      ["thinking"],
    ])("carries %s onto the text part", (field) => {
      const [part] = flatten([
        {
          id: "m1",
          role: "assistant",
          content: "The answer is 4.",
          [field]: "2+2 is addition.",
        },
      ]);

      expect(part).toMatchObject({
        kind: "text",
        reasoning: "2+2 is addition.",
      });
    });

    it("ignores an empty reasoning field", () => {
      const [part] = flatten([
        { id: "m1", role: "assistant", content: "hi", reasoning_content: "  " },
      ]);

      expect(part).toMatchObject({ kind: "text", reasoning: undefined });
    });
  });

  describe("given audio and its transcript in one message", () => {
    /** @scenario "An audio part and its sibling text collapse into one part" */
    it("collapses them into a single media part", () => {
      const parts = flatten([
        {
          id: "m1",
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: "AAAA", format: "wav" },
            },
            { type: "text", text: "what is the weather" },
          ],
        },
      ]);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        kind: "media",
        transcript: "what is the weather",
      });
    });
  });

  describe("given a message with nothing to show", () => {
    /** @scenario "A message with no usable content produces nothing" */
    it.each([["None"], [""], [null]])("produces no parts for %s", (content) => {
      expect(flatten([{ id: "m1", role: "assistant", content }])).toEqual([]);
    });
  });

  describe("given a failed turn", () => {
    it("replaces the reply with an error part", () => {
      const parts = flattenMessages({
        messages: [message({ id: "m1", role: "assistant", content: "" })],
        errors: { m1: { type: "rate_limit", message: "429" } },
      });

      expect(parts).toEqual([
        {
          kind: "error",
          id: "m1",
          error: { type: "rate_limit", message: "429" },
          traceId: undefined,
        },
      ]);
    });
  });

  describe("given a reply still streaming", () => {
    it("appends it once, and not again after it is stored", () => {
      const streaming = [
        { messageId: "m1", role: "assistant", content: "par" },
      ];

      const inFlight = flattenMessages({ messages: [], streaming });
      expect(inFlight).toHaveLength(1);
      expect(inFlight[0]).toMatchObject({ kind: "text", content: "par" });

      const stored = flattenMessages({
        messages: [
          message({ id: "m1", role: "assistant", content: "partial" }),
        ],
        streaming,
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ content: "partial" });
    });
  });
});

describe("groupIntoTurns", () => {
  const part = (id: string, traceId?: string): DisplayPart => ({
    kind: "text",
    id,
    role: "assistant",
    content: id,
    traceId,
  });

  /** @scenario "Consecutive parts sharing a trace are grouped into one turn" */
  it("numbers each run of parts that share a trace", () => {
    const turns = groupIntoTurns([
      part("a", "trace-1"),
      part("b", "trace-1"),
      part("c", "trace-1"),
      part("d", "trace-2"),
      part("e", "trace-2"),
    ]);

    expect(turns.map((turn) => [turn.turnNumber, turn.parts.length])).toEqual([
      [1, 3],
      [2, 2],
    ]);
  });

  /** @scenario "An untraced part leading a traced one joins that turn" */
  it("folds a leading untraced part into the turn that answers it", () => {
    const turns = groupIntoTurns([part("a"), part("b", "trace-1")]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.turnNumber).toBe(1);
    expect(turns[0]?.parts.map((p) => p.content)).toEqual(["a", "b"]);
  });

  /** @scenario "An untraced part with nothing after it is left unnumbered" */
  it("leaves a trailing untraced part unnumbered", () => {
    const turns = groupIntoTurns([part("a", "trace-1"), part("b")]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.turnNumber).toBe(1);
    expect(turns[1]?.turnNumber).toBeUndefined();
    expect(turns[1]?.parts.map((p) => p.content)).toEqual(["b"]);
  });
});
