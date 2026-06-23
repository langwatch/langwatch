import { describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../types/trace";
import type { ParsedTurn } from "../types";
import { buildConversationMarkdownChunks } from "../utils";

/**
 * The conversation Markdown export must emit a `[Redacted]` sentinel for
 * turns the server has nulled — otherwise a pasted transcript looks like
 * the turn never happened, which is misleading for whoever's reading it
 * later (compliance reviewer, support ticket, audit trail).
 */

const trace = (overrides: Partial<TraceListItem> = {}): TraceListItem => ({
  traceId: "trc",
  timestamp: 0,
  name: "trace",
  serviceName: "svc",
  durationMs: 100,
  totalCost: 0,
  nonBilledCost: 0,
  totalTokens: 0,
  models: [],
  labels: [],
  status: "completed",
  spanCount: 1,
  sizeBytes: 0,
  input: null,
  output: null,
  evaluations: [],
  events: [],
  origin: "application",
  ...overrides,
});

const turn = (overrides: Partial<ParsedTurn> = {}): ParsedTurn => ({
  turn: trace(),
  userText: "",
  assistantText: "",
  assistantReasoning: "",
  gapSecs: 0,
  showGap: false,
  ...overrides,
});

const userMarkdown = (chunks: { id: string; markdown: string }[]) =>
  chunks.find((c) => c.id === "turn-1-user")?.markdown ?? "";
const assistantMarkdown = (chunks: { id: string; markdown: string }[]) =>
  chunks.find((c) => c.id === "turn-1-assistant")?.markdown ?? "";

describe("buildConversationMarkdownChunks — redaction sentinel", () => {
  describe("given a turn whose input was redacted (server nulled the text)", () => {
    it("emits **User:** [Redacted] instead of silently dropping the turn", () => {
      const chunks = buildConversationMarkdownChunks("conv", [
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
      const chunks = buildConversationMarkdownChunks("conv", [
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
      const chunks = buildConversationMarkdownChunks("conv", [
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
      const chunks = buildConversationMarkdownChunks("conv", [
        turn({ userText: "hello", assistantText: "world" }),
      ]);
      expect(userMarkdown(chunks)).toContain("hello");
      expect(assistantMarkdown(chunks)).toContain("world");
    });
  });
});
