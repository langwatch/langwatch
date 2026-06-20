import { describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../types/trace";
import type { ParsedTurn } from "../types";
import {
  buildConversationMarkdownChunks,
  joinConversationMarkdown,
} from "../utils";

function makeTurn(opts: {
  output: string;
  assistantText: string;
  userText?: string;
}): ParsedTurn {
  return {
    turn: {
      traceId: "t1",
      timestamp: 1_700_000_000_000,
      durationMs: 1000,
      models: ["gpt-4o"],
      totalCost: 0.01,
      totalTokens: 100,
      output: opts.output,
      error: null,
    } as unknown as TraceListItem,
    userText: opts.userText ?? "Hello",
    assistantText: opts.assistantText,
    assistantReasoning: "",
    gapSecs: 0,
    showGap: false,
  };
}

const assistantChunkOf = (
  chunks: { id: string; markdown: string }[],
): string | undefined => chunks.find((c) => c.id.endsWith("-assistant"))?.markdown;

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
      const chunks = buildConversationMarkdownChunks("conv-1", [
        makeTurn({ output: rawJson, assistantText: "The answer is 42." }),
      ]);
      const md = assistantChunkOf(chunks);
      expect(md).toContain("The answer is 42.");
      expect(md).not.toContain('"type"');
      expect(md).not.toContain("role");
    });
  });

  describe("when an assistant turn has no extractable text", () => {
    it("falls back to the raw output rather than dropping the turn", () => {
      const chunks = buildConversationMarkdownChunks("conv-1", [
        makeTurn({ output: "plain text answer", assistantText: "" }),
      ]);
      expect(assistantChunkOf(chunks)).toContain("plain text answer");
    });
  });

  describe("joinConversationMarkdown", () => {
    it("concatenates chunk markdown for clipboard export", () => {
      const chunks = buildConversationMarkdownChunks("conv-1", [
        makeTurn({ output: "out", assistantText: "out" }),
      ]);
      const joined = joinConversationMarkdown(chunks);
      expect(joined).toContain("# Conversation");
      expect(joined).toContain("out");
    });
  });
});
