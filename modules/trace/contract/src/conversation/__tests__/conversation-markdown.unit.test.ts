import { describe, expect, it } from "vitest";

import {
  buildConversationMarkdownChunks,
  joinConversationMarkdown,
} from "../conversation-markdown.ts";
import { makeTurn } from "./conversation-markdown-fixtures.ts";

const assistantChunkOf = (chunks: { id: string; markdown: string }[]): string | undefined =>
  chunks.find((chunk) => chunk.id.endsWith("-assistant"))?.markdown;

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
        turns: [makeTurn({ output: rawJson, assistantText: "The answer is 42." })],
      });
      const markdown = assistantChunkOf(chunks);
      expect(markdown).toContain("The answer is 42.");
      expect(markdown).not.toContain('"type"');
      expect(markdown).not.toContain("role");
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
      expect(chunks.find((chunk) => chunk.id === "header")?.turnNumber).toBeUndefined();
      expect(chunks.find((chunk) => chunk.id === "turn-1-user")?.turnNumber).toBe(1);
      expect(chunks.find((chunk) => chunk.id === "turn-2-assistant")?.turnNumber).toBe(2);
    });
  });

  describe("when joinConversationMarkdown runs", () => {
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
