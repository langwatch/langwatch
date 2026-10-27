import { describe, expect, it } from "vitest";

import {
  buildConversationMarkdownChunks,
  type ConversationMarkdownChunk,
} from "../conversation-markdown.ts";
import type { ConversationTurnSource, ParsedTurn } from "../parsed-turns.ts";

/**
 * The Markdown export emits a `[Redacted]` sentinel for turns the server
 * nulled: otherwise a pasted transcript looks like the turn never happened,
 * which misleads whoever reads it later.
 */

const trace = (overrides: Partial<ConversationTurnSource> = {}): ConversationTurnSource => ({
  traceId: "trc",
  timestamp: 0,
  durationMs: 100,
  totalCost: 0,
  totalTokens: 0,
  models: [],
  input: null,
  output: null,
  ...overrides,
});

const turn = (
  overrides: Partial<ParsedTurn<ConversationTurnSource>> = {},
): ParsedTurn<ConversationTurnSource> => ({
  turn: trace(),
  userText: "",
  assistantText: "",
  assistantReasoning: "",
  userMedia: [],
  assistantMedia: [],
  gapSecs: 0,
  shouldShowGap: false,
  ...overrides,
});

const chunksFor = (turns: ParsedTurn<ConversationTurnSource>[]) =>
  buildConversationMarkdownChunks({ conversationId: "conv", turns });

const userMarkdown = (chunks: ConversationMarkdownChunk[]) =>
  chunks.find((c) => c.id === "turn-1-user")?.markdown ?? "";
const assistantMarkdown = (chunks: ConversationMarkdownChunk[]) =>
  chunks.find((c) => c.id === "turn-1-assistant")?.markdown ?? "";

describe("buildConversationMarkdownChunks — redaction sentinel", () => {
  describe("given a turn whose input was redacted (server nulled the text)", () => {
    it("emits **User:** [Redacted] instead of silently dropping the turn", () => {
      const chunks = chunksFor([
        turn({
          turn: trace({ inputRedacted: true }),
          userText: "",
          assistantText: "ok",
        }),
      ]);
      const text = userMarkdown(chunks);
      expect(text).toContain("**User:**");
      expect(text).toContain("_[Redacted]_");
    });
  });

  describe("given a turn whose output was redacted (assistant nulled)", () => {
    it("emits **Assistant:** [Redacted] instead of silently dropping the turn", () => {
      const chunks = chunksFor([
        turn({
          turn: trace({ outputRedacted: true }),
          userText: "ask",
          assistantText: "",
        }),
      ]);
      const text = assistantMarkdown(chunks);
      expect(text).toContain("**Assistant:**");
      expect(text).toContain("_[Redacted]_");
    });
  });

  describe("given a turn with no redaction and empty assistant text", () => {
    it("does not emit a sentinel — the assistant row is absent (no false redaction)", () => {
      const chunks = chunksFor([
        turn({
          turn: trace({ output: null }),
          userText: "ask",
          assistantText: "",
        }),
      ]);
      expect(assistantMarkdown(chunks)).toBe("");
    });
  });

  describe("given a normal turn (both sides present)", () => {
    it("emits the user + assistant text untouched", () => {
      const chunks = chunksFor([turn({ userText: "hello", assistantText: "world" })]);
      expect(userMarkdown(chunks)).toContain("hello");
      expect(assistantMarkdown(chunks)).toContain("world");
    });
  });
});
