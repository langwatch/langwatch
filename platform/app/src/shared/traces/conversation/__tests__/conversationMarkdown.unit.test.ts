import { describe, expect, it } from "vitest";
import {
  buildConversationMarkdownChunks,
  joinConversationMarkdown,
  renderConversationMarkdown,
} from "../conversationMarkdown";
import type { ConversationTurnSource, ParsedTurn } from "../parsedTurns";

function makeTurn(opts: {
  output: string;
  assistantText: string;
  userText?: string;
  traceId?: string;
  timestamp?: number;
}): ParsedTurn<ConversationTurnSource> {
  return {
    turn: {
      traceId: opts.traceId ?? "t1",
      timestamp: opts.timestamp ?? 1_700_000_000_000,
      durationMs: 1000,
      models: ["gpt-4o"],
      totalCost: 0.01,
      totalTokens: 100,
      input: null,
      output: opts.output,
    },
    userText: opts.userText ?? "Hello",
    assistantText: opts.assistantText,
    assistantReasoning: "",
    userMedia: [],
    assistantMedia: [],
    gapSecs: 0,
    shouldShowGap: false,
  };
}

const assistantChunkOf = (
  chunks: { id: string; markdown: string }[],
): string | undefined =>
  chunks.find((c) => c.id.endsWith("-assistant"))?.markdown;

describe("buildConversationMarkdownChunks", () => {
  describe("when an assistant turn carries typed-block output", () => {
    it("emits the clean extracted prose, not the raw JSON envelope", () => {
      const rawJson = JSON.stringify([
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "hmm" },
            { type: "text", text: "The answer is 42." },
          ],
        },
      ]);
      const chunks = buildConversationMarkdownChunks({
        conversationId: "conv-1",
        turns: [
          makeTurn({ output: rawJson, assistantText: "The answer is 42." }),
        ],
      });
      const md = assistantChunkOf(chunks);
      expect(md).toContain("The answer is 42.");
      expect(md).not.toContain('"type"');
      expect(md).not.toContain("role");
    });
  });

  describe("when an assistant turn has no extractable text", () => {
    it("falls back to the raw output rather than dropping the turn", () => {
      const chunks = buildConversationMarkdownChunks({
        conversationId: "conv-1",
        turns: [makeTurn({ output: "plain text answer", assistantText: "" })],
      });
      expect(assistantChunkOf(chunks)).toContain("plain text answer");
    });
  });

  describe("when the chunks belong to numbered turns", () => {
    /** @scenario "Conversation markdown chunks name the turn they belong to" */
    it("tags every turn chunk with its turn number and leaves the preamble untagged", () => {
      const chunks = buildConversationMarkdownChunks({
        conversationId: "conv-1",
        turns: [
          makeTurn({ output: "first", assistantText: "first" }),
          makeTurn({ output: "second", assistantText: "second" }),
        ],
      });
      expect(chunks.find((c) => c.id === "header")?.turnNumber).toBeUndefined();
      expect(chunks.find((c) => c.id === "turn-1-user")?.turnNumber).toBe(1);
      expect(chunks.find((c) => c.id === "turn-2-assistant")?.turnNumber).toBe(
        2,
      );
    });
  });

  describe("joinConversationMarkdown", () => {
    it("concatenates chunk markdown for clipboard export", () => {
      const chunks = buildConversationMarkdownChunks({
        conversationId: "conv-1",
        turns: [makeTurn({ output: "out", assistantText: "out" })],
      });
      const joined = joinConversationMarkdown(chunks);
      expect(joined).toContain("# Conversation");
      expect(joined).toContain("out");
    });
  });
});

describe("renderConversationMarkdown", () => {
  const manyTurns = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      makeTurn({
        traceId: `t${i}`,
        timestamp: 1_700_000_000_000 + i * 1000,
        userText: `question ${i} ${"padding ".repeat(40)}`,
        output: `answer ${i} ${"padding ".repeat(40)}`,
        assistantText: `answer ${i} ${"padding ".repeat(40)}`,
      }),
    );

  describe("given no budget", () => {
    /** @scenario "A conversation that fits the budget is rendered whole" */
    it("renders the whole conversation and reports it as untruncated", () => {
      const result = renderConversationMarkdown({
        conversationId: "conv-1",
        turns: manyTurns(3),
      });
      expect(result.truncated).toBe(false);
      expect(result.omittedTurns).toBe(0);
      expect(result.text).toContain("question 0");
      expect(result.text).toContain("question 2");
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe("given a budget the conversation fits inside", () => {
    /** @scenario "A conversation that fits the budget is rendered whole" */
    it("renders it whole", () => {
      const turns = manyTurns(3);
      const whole = renderConversationMarkdown({ turns });
      const result = renderConversationMarkdown({
        turns,
        maxTokens: whole.estimatedTokens,
      });
      expect(result.truncated).toBe(false);
      expect(result.text).toBe(whole.text);
    });
  });

  describe("given a budget smaller than the conversation", () => {
    /** @scenario "A conversation over the budget keeps its head and tail and marks the cut" */
    it("keeps the first and last turns, drops the middle, and says how many", () => {
      const turns = manyTurns(30);
      const result = renderConversationMarkdown({
        conversationId: "conv-1",
        turns,
        maxTokens: 600,
      });
      expect(result.truncated).toBe(true);
      expect(result.omittedTurns).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeLessThanOrEqual(600);
      expect(result.text).toContain("omitted to fit the token budget");
      // The preamble always survives, so the reader still sees which
      // conversation this is and how many turns it really had.
      expect(result.text).toContain("# Conversation `conv-1`");
      expect(result.text).toContain("- **Turns:** 30");
      // Both ends survive: a regression that kept only one of them would
      // otherwise pass.
      expect(result.text).toContain("question 0");
      expect(result.text).toContain("question 29");
    });

    /** @scenario "A conversation over the budget keeps its head and tail and marks the cut" */
    it("spends more of the budget on the tail than on the head", () => {
      const result = renderConversationMarkdown({
        turns: manyTurns(40),
        maxTokens: 900,
      });
      const kept = [...result.text.matchAll(/## Turn (\d+)/g)].map((m) =>
        Number(m[1]),
      );
      const head = kept.filter((n) => n <= 5).length;
      const tail = kept.filter((n) => n > 35).length;
      expect(tail).toBeGreaterThan(head);
      expect(kept).toContain(40);
    });
  });

  describe("given a budget no whole turn fits inside", () => {
    /** @scenario "A single turn larger than the whole budget is cut mid-turn" */
    it("spends what is left on the end of the conversation", () => {
      const turns = manyTurns(4);
      const oneTurn = renderConversationMarkdown({
        turns: [turns[3]!],
      }).estimatedTokens;
      // Room for the preamble and most of a turn, but not a whole one.
      const result = renderConversationMarkdown({
        conversationId: "conv-1",
        turns,
        maxTokens: oneTurn,
      });
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(oneTurn);
      // The heading survives, and so does part of the final turn: a budget
      // that only buys a heading buys nothing worth reading.
      expect(result.text).toContain("# Conversation `conv-1`");
      expect(result.text).toContain("question 3");
      expect(result.text).toContain("truncated to fit the token budget");
    });
  });

  describe("given a budget too small to hold even the marker", () => {
    /** @scenario "A single turn larger than the whole budget is cut mid-turn" */
    it("keeps the budget rather than the marker", () => {
      const result = renderConversationMarkdown({
        turns: manyTurns(3),
        maxTokens: 1,
      });
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(1);
    });
  });

  describe("given a budget no single turn fits inside", () => {
    /** @scenario "A single turn larger than the whole budget is cut mid-turn" */
    it("cuts the text and marks it as truncated", () => {
      const result = renderConversationMarkdown({
        turns: manyTurns(5),
        maxTokens: 40,
      });
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(40);
      expect(result.text).toContain("truncated to fit the token budget");
    });
  });
});
