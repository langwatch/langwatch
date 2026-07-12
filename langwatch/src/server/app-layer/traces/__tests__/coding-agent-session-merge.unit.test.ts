import { describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import { mergeCodingAgentSessionRows } from "../coding-agent-session-merge";

function row(over: Partial<CodingAgentSessionRow>): CodingAgentSessionRow {
  return {
    tenantId: "project_1",
    traceId: "trace-1",
    version: "2026-07-11",
    startedAtMs: 1_000,
    agent: "claude_code",
    agentVersion: "2.1.207",
    sessionId: "session-1",
    finalRequestId: "req-1",
    userId: "user-1",
    terminalType: "xterm-256color",
    entrypoint: "cli",
    modelCalls: 0,
    toolCalls: 0,
    subAgents: 0,
    prompts: 0,
    promptChars: 0,
    responseChars: 0,
    steps: [],
    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    models: [],
    mcpServers: [],
    mcpTools: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    modelCallMs: 0,
    toolMs: 0,
    ttftMsTotal: 0,
    ttftSamples: 0,
    blockedOnUserMs: 0,
    activeTimeUserSec: 0,
    activeTimeCliSec: 0,
    toolResultBytes: 0,
    toolInputBytes: 0,
    compactions: 0,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    peakContextTokens: 0,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    failedTools: 0,
    errorTypes: {},
    apiErrors: 0,
    rateLimited: 0,
    retriesExhausted: 0,
    retryMs: 0,
    attempts: 0,
    refusals: 0,
    refusalCategories: [],
    internalErrors: 0,
    toolsDenied: 0,
    toolsAborted: 0,
    permissionMode: "default",
    permissionChanges: 0,
    hooksBlocked: 0,
    hooksCancelled: 0,
    hookMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    commits: 0,
    pullRequests: 0,
    editsAccepted: 0,
    editsRejected: 0,
    languagesEdited: [],
    atMentions: 0,
    stopReason: "end_turn",
    truncated: false,
    ...over,
  };
}

describe("mergeCodingAgentSessionRows", () => {
  describe("given a session that crossed two traces (e.g. it hit its own session limit)", () => {
    const earlier = row({
      traceId: "trace-early",
      startedAtMs: 1_000,
      finalRequestId: "req-early",
      stopReason: "max_tokens",
      truncated: true,
      permissionMode: "plan",
      modelCalls: 10,
      toolCalls: 20,
      costUsd: 5,
      toolCounts: { Bash: 8, Read: 12 },
      models: ["claude-opus-4-8"],
      steps: [
        ["Read", 2, false],
        ["Bash", 3, false],
      ],
    });
    const later = row({
      traceId: "trace-later",
      startedAtMs: 2_000,
      finalRequestId: "req-later",
      stopReason: "end_turn",
      truncated: false,
      permissionMode: "default",
      modelCalls: 5,
      toolCalls: 10,
      costUsd: 3,
      toolCounts: { Bash: 4, Edit: 6 },
      models: ["claude-sonnet-5"],
      steps: [
        ["Bash", 1, false],
        ["Edit", 2, true],
      ],
    });

    it("sums the work across every trace", () => {
      const merged = mergeCodingAgentSessionRows([later, earlier]);
      expect(merged.modelCalls).toBe(15);
      expect(merged.toolCalls).toBe(30);
      expect(merged.costUsd).toBe(8);
    });

    it("merges per-tool counts across traces", () => {
      const merged = mergeCodingAgentSessionRows([earlier, later]);
      expect(merged.toolCounts).toEqual({ Bash: 12, Read: 12, Edit: 6 });
    });

    it("unions bounded sets rather than keeping only the first trace's", () => {
      const merged = mergeCodingAgentSessionRows([earlier, later]);
      expect(merged.models).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
    });

    it("lists every trace in the session, oldest first, regardless of input order", () => {
      const merged = mergeCodingAgentSessionRows([later, earlier]);
      expect(merged.traceIds).toEqual(["trace-early", "trace-later"]);
    });

    it("takes identity from the FIRST trace and how-it-ended from the LAST", () => {
      const merged = mergeCodingAgentSessionRows([later, earlier]);
      expect(merged.traceId).toBe("trace-early");
      expect(merged.finalRequestId).toBe("req-later");
      expect(merged.stopReason).toBe("end_turn");
      expect(merged.truncated).toBe(false);
      // The mode it ENDED in, not the mode it started in — an escalation from
      // plan to default is the interesting fact, not the plan-mode start.
      expect(merged.permissionMode).toBe("default");
    });

    it("re-batches a step that was really one run split across the trace boundary", () => {
      // earlier ends on Bash×3, later opens on Bash×1 — one continuous run.
      const merged = mergeCodingAgentSessionRows([earlier, later]);
      expect(merged.steps).toEqual([
        ["Read", 2, false],
        ["Bash", 4, false],
        ["Edit", 2, true],
      ]);
    });
  });

  describe("given a single-trace session (the common case)", () => {
    it("is a no-op merge — same numbers, one trace id", () => {
      const only = row({ modelCalls: 7, toolCalls: 3 });
      const merged = mergeCodingAgentSessionRows([only]);
      expect(merged.modelCalls).toBe(7);
      expect(merged.toolCalls).toBe(3);
      expect(merged.traceIds).toEqual(["trace-1"]);
    });
  });

  describe("given context-health fields across two traces", () => {
    it("maxes peak context and the largest rebuild, but sums the rebuild count", () => {
      const early = row({
        traceId: "trace-early",
        startedAtMs: 1_000,
        peakContextTokens: 90_000,
        cacheRebuildCount: 2,
        largestCacheRebuildTokens: 12_000,
      });
      const later = row({
        traceId: "trace-later",
        startedAtMs: 2_000,
        peakContextTokens: 40_000,
        cacheRebuildCount: 1,
        largestCacheRebuildTokens: 30_000,
      });

      const merged = mergeCodingAgentSessionRows([early, later]);

      // The whole session's worst moment, not whichever trace merge saw last.
      expect(merged.peakContextTokens).toBe(90_000);
      expect(merged.largestCacheRebuildTokens).toBe(30_000);
      // How many times it happened, across the whole session.
      expect(merged.cacheRebuildCount).toBe(3);
    });
  });
});
