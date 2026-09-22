import { describe, expect, it } from "vitest";

import { renderConversationMarkdown } from "../conversation-markdown-bounded.ts";
import { makeTurn } from "./conversation-markdown-fixtures.ts";

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
      expect(result.isTruncated).toBe(false);
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
      expect(result.isTruncated).toBe(false);
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
      expect(result.isTruncated).toBe(true);
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
      const kept = [...result.text.matchAll(/## Turn (\d+)/g)].map((m) => Number(m[1]));
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
      expect(result.isTruncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(oneTurn);
      // The heading survives, and so does part of the final turn: a budget
      // that only buys a heading buys nothing worth reading.
      expect(result.text).toContain("# Conversation `conv-1`");
      expect(result.text).toContain("question 3");
      expect(result.text).toContain("truncated to fit the token budget");
    });

    it("counts only the turns that were dropped whole as omitted", () => {
      const turns = manyTurns(4);
      const oneTurn = renderConversationMarkdown({
        turns: [turns[3]!],
      }).estimatedTokens;
      const result = renderConversationMarkdown({
        conversationId: "conv-1",
        turns,
        maxTokens: oneTurn,
      });
      // The final turn is on the page, cut mid-turn; the three before it are
      // the ones that went missing.
      expect(result.text).toContain("question 3");
      expect(result.omittedTurns).toBe(3);
    });

    it("stays inside the budget at every budget from one token up to one turn", () => {
      const turns = manyTurns(4);
      const oneTurn = renderConversationMarkdown({
        turns: [turns[3]!],
      }).estimatedTokens;
      for (let maxTokens = 1; maxTokens <= oneTurn; maxTokens++) {
        const result = renderConversationMarkdown({
          conversationId: "conv-1",
          turns,
          maxTokens,
        });
        expect(result.estimatedTokens).toBeLessThanOrEqual(maxTokens);
      }
    });
  });

  describe("given a budget too small to hold even the marker", () => {
    /** @scenario "A single turn larger than the whole budget is cut mid-turn" */
    it("keeps the budget rather than the marker", () => {
      const result = renderConversationMarkdown({
        turns: manyTurns(3),
        maxTokens: 1,
      });
      expect(result.isTruncated).toBe(true);
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
      expect(result.isTruncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(40);
      expect(result.text).toContain("truncated to fit the token budget");
    });
  });
});
