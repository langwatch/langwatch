import type { TranscriptEntry } from "@langwatch/coding-agent-contract";
/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionTranscript } from "../use-session-transcript.ts";

interface TranscriptCall {
  input: { projectId: string; traceId: string; occurredAtMs?: number; tenantId?: string };
}

const { reads, conversation } = vi.hoisted(() => ({
  /** Each turn's read as the query cache answers it, by trace id. */
  reads: {} as Record<string, { data?: { entries: TranscriptEntry[] }; isPending: boolean }>,
  /** The session's turns, time ascending, as the conversation read returns them. */
  conversation: {
    turns: [] as { traceId: string; timestamp: number }[],
    isLoading: false,
    requested: [] as TranscriptCall["input"][],
  },
}));

vi.mock("../../../../../../behavior/trace-api.ts", () => ({
  api: {
    useQueries: (build: (t: unknown) => TranscriptCall[]) => {
      const calls = build({
        codingAgents: { transcript: (input: TranscriptCall["input"]) => ({ input }) },
      });
      conversation.requested = calls.map((call) => call.input);
      return calls.map((call) => reads[call.input.traceId] ?? { isPending: true });
    },
  },
}));

vi.mock("../../../../../../features/conversation/behavior/use-conversation-context.ts", () => ({
  useConversationContext: () => ({
    turns: conversation.turns,
    isLoading: conversation.isLoading,
  }),
}));

const call = (atMs: number): TranscriptEntry => ({
  kind: "model_call",
  atMs,
  model: "gpt-6-luna",
  tokens: 28,
  costUsd: 0.0007,
  durationMs: 1_000,
  spanId: `chat-${atMs}`,
  inputTokens: 3,
  outputTokens: 25,
  cacheReadTokens: 9_000,
  cacheCreationTokens: 5_000,
});

const done = (entries: TranscriptEntry[]) => ({ data: { entries }, isPending: false });

function setup({ conversationId = "session-a" }: { conversationId?: string | null } = {}) {
  return renderHook(() =>
    useSessionTranscript({
      projectId: "project-1",
      tenantId: null,
      traceId: "turn-3",
      occurredAtMs: 3_050,
      conversationId,
    }),
  );
}

afterEach(() => {
  cleanup();
  for (const key of Object.keys(reads)) delete reads[key];
  conversation.turns = [];
  conversation.isLoading = false;
});

describe("useSessionTranscript", () => {
  describe("given a session of three turns opened on its last", () => {
    /** @scenario "The per-call chart draws every model call of the session" */
    it("holds every turn's model calls in the order the session made them", () => {
      conversation.turns = [
        { traceId: "turn-1", timestamp: 1_000 },
        { traceId: "turn-2", timestamp: 2_000 },
        { traceId: "turn-3", timestamp: 3_000 },
      ];
      reads["turn-1"] = done([call(1_100), call(1_200)]);
      reads["turn-2"] = done([call(2_100), call(2_200)]);
      reads["turn-3"] = done([call(3_100), call(3_200)]);

      const { result } = setup();

      expect(result.current.entries?.map((entry) => entry.atMs)).toEqual([
        1_100, 1_200, 2_100, 2_200, 3_100, 3_200,
      ]);
    });

    it("reads the opened turn under its own hint and the others under theirs", () => {
      conversation.turns = [
        { traceId: "turn-1", timestamp: 1_000 },
        { traceId: "turn-3", timestamp: 3_000 },
      ];

      setup();

      expect(conversation.requested).toEqual([
        { projectId: "project-1", traceId: "turn-1", occurredAtMs: 1_000 },
        { projectId: "project-1", traceId: "turn-3", occurredAtMs: 3_050 },
      ]);
    });

    it("draws nothing until every turn has answered", () => {
      conversation.turns = [
        { traceId: "turn-1", timestamp: 1_000 },
        { traceId: "turn-3", timestamp: 3_000 },
      ];
      reads["turn-3"] = done([call(3_100)]);

      const { result } = setup();

      expect(result.current.entries).toBeUndefined();
    });

    it("draws the turns that answered when one of them failed", () => {
      conversation.turns = [
        { traceId: "turn-1", timestamp: 1_000 },
        { traceId: "turn-3", timestamp: 3_000 },
      ];
      reads["turn-1"] = { isPending: false };
      reads["turn-3"] = done([call(3_100)]);

      const { result } = setup();

      expect(result.current.entries?.map((entry) => entry.atMs)).toEqual([3_100]);
    });

    it("waits for the session's turn list before reading", () => {
      conversation.isLoading = true;
      reads["turn-3"] = done([call(3_100)]);

      const { result } = setup();

      expect(result.current.entries).toBeUndefined();
    });
  });

  describe("given a trace outside any session", () => {
    /** @scenario "The per-call chart draws every model call of the session" */
    it("draws its own calls", () => {
      reads["turn-3"] = done([call(3_100), call(3_200)]);

      const { result } = setup({ conversationId: null });

      expect(result.current.entries?.map((entry) => entry.atMs)).toEqual([3_100, 3_200]);
      expect(conversation.requested).toEqual([
        { projectId: "project-1", traceId: "turn-3", occurredAtMs: 3_050 },
      ]);
    });
  });
});
