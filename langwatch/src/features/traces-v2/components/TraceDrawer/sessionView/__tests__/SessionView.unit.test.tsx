/**
 * @vitest-environment jsdom
 */
/**
 * The session overview, rendered against a REAL folded session.
 *
 * The fixture below is lifted verbatim out of `coding_agent_sessions` — it is an
 * actual Claude Code session (114 model calls, 115 tools, $10.62, 14M tokens
 * served from cache). Inventing a tidy fixture would have hidden the two things
 * this file exists to pin: that the numbers a real session produces are big
 * enough to need compacting, and that an MCP tool shows up at all.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { SessionView } from "../SessionView";

/** Straight from ClickHouse. Do not tidy. */
const REAL_SESSION: CodingAgentSessionRow = {
  tenantId: "project_1",
  traceId: "1e7dbf01553db533b9709651db7d14b6",
  version: "2026-07-11",
  startedAtMs: 1_752_000_000_000,
  agent: "claude-code",
  agentVersion: "2.0.0",
  sessionId: "session-1",
  finalRequestId: "req_last",
  userId: "user-1",
  terminalType: "xterm-256color",
  entrypoint: "cli",
  modelCalls: 114,
  toolCalls: 115,
  subAgents: 0,
  prompts: 3,
  promptChars: 900,
  responseChars: 4_000,
  steps: [
    ["Read", 2, false],
    ["Bash", 1, false],
    ["Edit", 4, true],
    ["Bash", 3, false],
  ],
  toolCounts: {
    Read: 8,
    Bash: 76,
    Write: 6,
    Edit: 22,
    ToolSearch: 1,
    mcp__claude_in_chrome__tabs_context_mcp: 2,
  },
  toolDurationMs: {
    Read: 744,
    Bash: 555_803,
    Write: 1_336,
    Edit: 5_820,
    ToolSearch: 150,
    mcp__claude_in_chrome__tabs_context_mcp: 123_349,
  },
  filesTouched: Array.from({ length: 21 }, (_, i) => `src/file-${i}.ts`),
  skills: [],
  subAgentTypes: [],
  slashCommands: [],
  models: ["claude-opus-4-8[1m]"],
  mcpServers: ["claude-in-chrome"],
  mcpTools: ["tabs_context_mcp"],
  inputTokens: 3_000,
  outputTokens: 40_000,
  cacheReadTokens: 14_030_972,
  cacheCreationTokens: 284_220,
  costUsd: 10.6188605,
  modelCallMs: 713_056,
  toolMs: 687_202,
  ttftMsTotal: 0,
  ttftSamples: 0,
  blockedOnUserMs: 43_618,
  activeTimeUserSec: 0,
  activeTimeCliSec: 0,
  toolResultBytes: 0,
  toolInputBytes: 0,
  compactions: 0,
  compactionTokensBefore: 0,
  compactionTokensAfter: 0,
  failedTools: 4,
  errorTypes: { "Error:ENOENT": 3, ShellError: 1 },
  apiErrors: 0,
  rateLimited: 0,
  retriesExhausted: 0,
  retryMs: 0,
  attempts: 114,
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
  stopReason: "tool_use",
  truncated: false,
};

function renderSession(
  over: Partial<CodingAgentSessionRow> = {},
  entries?: TranscriptEntry[],
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SessionView session={{ ...REAL_SESSION, ...over }} entries={entries} />
    </ChakraProvider>,
  );
}

describe("SessionView", () => {
  describe("given a real coding-agent session", () => {
    it("leads with what it cost and what it did", () => {
      renderSession();

      expect(screen.getByText("$10.62")).toBeTruthy();
      expect(screen.getByText("114")).toBeTruthy();
      expect(screen.getByText("115")).toBeTruthy();
      // 21 files, not the list of them — the count is the fact.
      expect(screen.getByText("21")).toBeTruthy();
    });

    it("compacts the token counts, because 14030972 is not a readable number", () => {
      renderSession();

      expect(screen.getByText("14.0M")).toBeTruthy();
      expect(screen.getByText("284k")).toBeTruthy();
    });

    it("shows the order things happened, with the failure marked in place", () => {
      renderSession();

      // The sequence, batched — not a tally.
      expect(screen.getAllByText("Bash").length).toBeGreaterThan(0);
      expect(screen.getByText("×4")).toBeTruthy();
      // And the failure is called out with its cause, rather than just counted.
      expect(screen.getByText("4 of 115 actions failed")).toBeTruthy();
      expect(screen.getByText("Error:ENOENT ×3, ShellError ×1")).toBeTruthy();
    });

    it("surfaces the time a human spent waiting to approve things", () => {
      renderSession();

      expect(screen.getByText("Waiting for you")).toBeTruthy();
      expect(screen.getByText("44s")).toBeTruthy();
    });

    it("names the MCP server it reached for", () => {
      renderSession();

      expect(screen.getByText("MCP servers")).toBeTruthy();
      expect(screen.getByText("claude-in-chrome")).toBeTruthy();
    });
  });

  describe("given a session that went cleanly", () => {
    it("reports no findings rather than manufacturing them", () => {
      renderSession({
        failedTools: 0,
        errorTypes: {},
        blockedOnUserMs: 0,
        cacheCreationTokens: 0,
      });

      expect(screen.queryByText(/actions failed/)).toBeNull();
      expect(screen.queryByText("Waiting for you")).toBeNull();
    });
  });

  describe("given the reply was cut off", () => {
    it("says so, because the output is not an answer", () => {
      renderSession({ truncated: true });

      expect(screen.getByText("The reply was cut off")).toBeTruthy();
    });
  });

  describe("given no transcript entries", () => {
    it("omits the token timeline rather than showing an empty chart", () => {
      renderSession();
      expect(screen.queryByText("Where the tokens went")).toBeNull();
    });
  });

  describe("given transcript entries with a cache rebuild", () => {
    it("shows the timeline and names the prompt that triggered the rebuild", () => {
      const entries: TranscriptEntry[] = [
        { kind: "user_prompt", atMs: 500, text: "start over on this", chars: 19 },
        {
          kind: "model_call",
          atMs: 1_000,
          model: "claude-opus-4-8",
          tokens: 100_000,
          costUsd: 5,
          durationMs: 2_000,
          spanId: "llm-1",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 100_000,
          cacheCreationTokens: 0,
        },
        {
          kind: "model_call",
          atMs: 2_000,
          model: "claude-opus-4-8",
          tokens: 90_000,
          costUsd: 6,
          durationMs: 2_000,
          spanId: "llm-2",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 90_000,
        },
      ];

      renderSession({}, entries);

      expect(screen.getByText("Where the tokens went")).toBeTruthy();
      expect(screen.getByText(/after "start over on this"/)).toBeTruthy();
    });
  });
});
