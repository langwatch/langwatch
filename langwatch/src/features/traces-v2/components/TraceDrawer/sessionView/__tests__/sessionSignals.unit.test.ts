import { describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import {
  deriveSessionSignals,
  formatCompact,
  formatShortDuration,
} from "../sessionSignals";

/** A healthy session: nothing to report. */
function session(
  over: Partial<CodingAgentSessionRow> = {},
): CodingAgentSessionRow {
  return {
    tenantId: "project-1",
    traceId: "trace-1",
    version: "2026-07-11",
    startedAtMs: 1_700_000_000_000,
    agent: "claude-code",
    agentVersion: "2.0.0",
    sessionId: "session-1",
    finalRequestId: "req_9",
    userId: "user-1",
    terminalType: "xterm-256color",
    entrypoint: "cli",
    modelCalls: 10,
    toolCalls: 20,
    subAgents: 0,
    prompts: 1,
    promptChars: 100,
    responseChars: 500,
    steps: [],
    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    models: ["claude-opus-4-8"],
    mcpServers: [],
    mcpTools: [],
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 0,
    costUsd: 1.5,
    modelCallMs: 30_000,
    toolMs: 10_000,
    ttftMsTotal: 2_000,
    ttftSamples: 2,
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
    attempts: 10,
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

const ids = (row: CodingAgentSessionRow) =>
  deriveSessionSignals(row).map((s) => s.id);

describe("deriveSessionSignals", () => {
  describe("given a session that went fine", () => {
    it("says nothing at all, rather than inventing a finding", () => {
      expect(deriveSessionSignals(session())).toEqual([]);
    });
  });

  describe("given the reply was cut off", () => {
    // This changes how you read the whole screen: the session did not finish,
    // so its output is not an answer. It has to lead.
    it("reports it first", () => {
      const signals = deriveSessionSignals(
        session({ truncated: true, rateLimited: 2 }),
      );

      expect(signals[0]!.id).toBe("truncated");
      expect(signals[0]!.tone).toBe("danger");
    });
  });

  describe("given the cache was rebuilt out of proportion to what it reused", () => {
    it("reports the churn, because the raw token count never would", () => {
      const signals = deriveSessionSignals(
        session({ cacheReadTokens: 400_000, cacheCreationTokens: 200_000 }),
      );

      const churn = signals.find((s) => s.id === "cache-churn");
      expect(churn).toBeDefined();
      // The comparison IS the finding — both sides have to be in the sentence.
      expect(churn!.detail).toContain("200k");
      expect(churn!.detail).toContain("400k");
    });
  });

  describe("given a long session that warmed its cache once", () => {
    // Every session pays to write the cache the first time. Flagging that would
    // train people to ignore the signal, which is worse than not having it.
    it("stays quiet", () => {
      expect(
        ids(
          session({ cacheReadTokens: 8_000_000, cacheCreationTokens: 100_000 }),
        ),
      ).not.toContain("cache-churn");
    });
  });

  describe("given a trivial amount of cache rebuilding", () => {
    it("stays quiet even though the ratio is high", () => {
      // 900 of 1000 is 90% — but 900 tokens is not a story.
      expect(
        ids(session({ cacheReadTokens: 1_000, cacheCreationTokens: 900 })),
      ).not.toContain("cache-churn");
    });
  });

  describe("given a human sat waiting to approve tools", () => {
    it("reports the idle time — nothing else in the session surfaces it", () => {
      const signals = deriveSessionSignals(session({ blockedOnUserMs: 372_000 }));

      const blocked = signals.find((s) => s.id === "blocked-on-user");
      expect(blocked).toBeDefined();
      expect(blocked!.detail).toContain("6m 12s");
    });

    it("ignores a couple of seconds of approval", () => {
      expect(ids(session({ blockedOnUserMs: 3_000 }))).not.toContain(
        "blocked-on-user",
      );
    });
  });

  describe("given tools failed", () => {
    it("names the failure classes rather than just counting them", () => {
      const signals = deriveSessionSignals(
        session({
          failedTools: 4,
          toolCalls: 20,
          errorTypes: { "Error:ENOENT": 3, ShellError: 1 },
        }),
      );

      const failed = signals.find((s) => s.id === "failed-tools")!;
      expect(failed.title).toBe("4 of 20 actions failed");
      // Ordered by how often they happened — the common failure first.
      expect(failed.detail).toBe("Error:ENOENT ×3, ShellError ×1");
    });
  });

  describe("given the provider turned requests away", () => {
    it("tells rate limiting apart from every other failure", () => {
      const signals = deriveSessionSignals(session({ rateLimited: 3 }));
      expect(signals.find((s) => s.id === "rate-limited")!.tone).toBe("danger");
    });
  });

  describe("given a tool the user declined", () => {
    // A denied tool produces NO span at all, so if this doesn't say it, nothing
    // in the entire trace does.
    it("reports it, since it leaves no other trace", () => {
      const signals = deriveSessionSignals(session({ toolsDenied: 1 }));
      expect(signals.find((s) => s.id === "tools-denied")!.title).toBe(
        "1 action was declined",
      );
    });
  });

  describe("given approval settings were widened mid-session", () => {
    it("reports the escalation and where it landed", () => {
      const signals = deriveSessionSignals(
        session({ permissionChanges: 2, permissionMode: "bypassPermissions" }),
      );

      expect(signals.find((s) => s.id === "permission-changed")!.detail).toBe(
        "Changed 2× — it ended in bypassPermissions.",
      );
    });
  });
});

describe("formatCompact", () => {
  it("keeps big token counts readable", () => {
    expect(formatCompact(8_107_505)).toBe("8.1M");
    expect(formatCompact(318_404)).toBe("318k");
    expect(formatCompact(942)).toBe("942");
  });
});

describe("formatShortDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatShortDuration(840)).toBe("840ms");
    expect(formatShortDuration(9_000)).toBe("9s");
    expect(formatShortDuration(372_000)).toBe("6m 12s");
    expect(formatShortDuration(3_840_000)).toBe("1h 4m");
  });
});
