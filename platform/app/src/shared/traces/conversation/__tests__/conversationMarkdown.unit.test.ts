import { describe, expect, it } from "vitest";
import {
  buildConversationMarkdownChunks,
  joinConversationMarkdown,
} from "../conversationMarkdown";
import { makeTurn } from "./conversationMarkdownFixtures";

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

  describe("turn headings", () => {
    /**
     * @scenario "Relative time in transcripts"
     * Turn headings must carry an absolute ISO timestamp, not a relative age
     * ("2m", "now"), so a rendered transcript is the same regardless of when
     * it is rendered and judgment caching works across requests.
     */
    it("uses an ISO timestamp in the turn heading, not a relative age", () => {
      const fixedMs = 1_700_000_000_000;
      const chunks = buildConversationMarkdownChunks({
        conversationId: "conv-1",
        turns: [makeTurn({ output: "out", assistantText: "out", timestamp: fixedMs })],
      });
      const header = chunks.find((c) => c.id === "turn-1-header");
      expect(header?.markdown).toContain(new Date(fixedMs).toISOString());
      // Must NOT contain a relative time token.
      expect(header?.markdown).not.toMatch(/\b\d+[mhd]\b/);
      expect(header?.markdown).not.toContain("now");
    });
  });
});
