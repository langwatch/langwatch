/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { TerminalView } from "../TerminalView";

afterEach(cleanup);

const entries: TranscriptEntry[] = [
  {
    kind: "user_prompt",
    atMs: 1000,
    text: "check git status and bump the version",
    chars: 39,
  },
  {
    kind: "model_call",
    atMs: 1500,
    model: "claude-opus-4",
    tokens: 175,
    costUsd: 0.06,
    durationMs: 400,
    spanId: "llm-1500",
    inputTokens: 150,
    outputTokens: 25,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
  {
    kind: "assistant_message",
    atMs: 2000,
    text: "Checking the working tree.",
    model: "claude-opus-4",
  },
  {
    kind: "tool",
    atMs: 2500,
    name: "Bash",
    mcpServer: null,
    input: { command: "git status" },
    output: "On branch \x1b[32mmain\x1b[0m\n\tmodified:   file.ts",
    durationMs: 120,
    failed: false,
    agentId: null,
    spanId: "t1",
  },
  {
    kind: "tool",
    atMs: 3000,
    name: "Edit",
    mcpServer: null,
    input: {
      file_path: "/src/version.ts",
      old_string: "const version = 1;",
      new_string: "const version = 2;",
    },
    output: "Applied edit to /src/version.ts",
    durationMs: 80,
    failed: false,
    agentId: null,
    spanId: "t2",
  },
];

function renderView(
  props: Partial<React.ComponentProps<typeof TerminalView>> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TerminalView entries={entries} {...props} />
    </ChakraProvider>,
  );
}

describe("TerminalView", () => {
  describe("given a Claude Code session with a prompt and tool calls", () => {
    it("shows the user's prompt", () => {
      renderView();
      expect(
        screen.getByText("check git status and bump the version"),
      ).toBeInTheDocument();
    });

    it("shows the assistant prose", () => {
      renderView();
      expect(
        screen.getByText("Checking the working tree."),
      ).toBeInTheDocument();
    });

    it("shows each tool call with its name and primary argument", () => {
      renderView();
      expect(screen.getByText("Bash")).toBeInTheDocument();
      expect(screen.getByText("(git status)")).toBeInTheDocument();
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    it("renders the Bash output with ANSI colours resolved to clean text", () => {
      const { container } = renderView();
      expect(container.textContent).not.toContain("\x1b");
      expect(container.textContent).toContain("On branch main");
    });

    it("renders an Edit as a code diff instead of the raw tool result", () => {
      const { container } = renderView();
      expect(screen.getByText("const version = 1;")).toBeInTheDocument();
      expect(screen.getByText("const version = 2;")).toBeInTheDocument();
      expect(screen.getByText("+1")).toBeInTheDocument();
      expect(screen.getByText("-1")).toBeInTheDocument();
      expect(container.textContent).not.toContain("Applied edit");
    });
  });

  describe("given the session's last model call is a lone tool request with no reply text", () => {
    // The bug this replaces: the client used to rebuild the transcript from
    // the LAST model call's rolling history, so a lone trailing tool call with
    // no text collapsed the whole session to one line.
    it("still shows every prompt and tool call, not just one collapsed step", () => {
      const noTrailingText: TranscriptEntry[] = [
        entries[0]!,
        entries[1]!,
        {
          ...(entries[2] as Extract<
            TranscriptEntry,
            { kind: "assistant_message" }
          >),
          text: null,
        },
        entries[3]!,
        entries[4]!,
      ];
      renderView({ entries: noTrailingText });
      expect(screen.getByText("Bash")).toBeInTheDocument();
      expect(screen.getByText("Edit")).toBeInTheDocument();
      expect(
        screen.getByText("check git status and bump the version"),
      ).toBeInTheDocument();
    });
  });

  describe("given a tool the user denied", () => {
    it("shows it as denied rather than silently missing", () => {
      const withDenial: TranscriptEntry[] = [
        entries[0]!,
        {
          kind: "tool_rejected",
          atMs: 1200,
          name: "Bash",
          reason: "user_reject",
        },
      ];
      renderView({ entries: withDenial });
      expect(
        screen.getByText(/denied by the user, never ran/),
      ).toBeInTheDocument();
    });
  });

  describe("given the session banner", () => {
    it("shows the Claude Code version, model, and repo above the transcript", () => {
      renderView({
        banner: {
          agent: "claude_code",
          version: "2.1.207",
          model: "claude-opus-4-8",
          repo: "langwatch/langwatch",
        },
      });
      expect(screen.getByText("Claude Code v2.1.207")).toBeInTheDocument();
      expect(screen.getByText("langwatch/langwatch")).toBeInTheDocument();
    });

    it("names another agent by its own identity, not Claude's", () => {
      renderView({
        banner: {
          agent: "gemini_cli",
          version: "0.51.0",
          model: "gemini-3.5-flash",
          repo: null,
        },
      });
      expect(screen.getByText("Gemini CLI v0.51.0")).toBeInTheDocument();
      expect(screen.queryByText(/Claude Code/)).toBeNull();
    });

    it("falls back to a generic identity when the agent is unknown", () => {
      renderView({
        banner: { agent: "unknown", version: "1.0.0", model: null, repo: null },
      });
      expect(screen.getByText("Coding agent v1.0.0")).toBeInTheDocument();
    });
  });

  describe("given a session name", () => {
    it("shows it in the bottom bar", () => {
      renderView({ sessionName: "Fix the flaky CI job" });
      expect(screen.getByText("Fix the flaky CI job")).toBeInTheDocument();
    });

    it("falls back to a placeholder when the trace has no name", () => {
      renderView();
      expect(screen.getByText("Untitled session")).toBeInTheDocument();
    });
  });

  describe("given per-entry token and cost metrics", () => {
    it("shows the cumulative token and cost totals in the timeline HUD", () => {
      renderView();
      expect(screen.getByText("175 tok")).toBeInTheDocument();
      expect(screen.getByText("$0.06")).toBeInTheDocument();
    });

    it("shows the step count at the last visible beat by default", () => {
      renderView();
      expect(screen.getByText("step 4/4")).toBeInTheDocument();
    });

    it("has no drag-to-scrub control — scrolling is the only way to travel through it", () => {
      renderView();
      expect(screen.queryByRole("slider")).toBeNull();
    });
  });

  describe("given the context grew into a bigger size band", () => {
    it("notes the band crossing once, at the next visible beat", () => {
      const growingEntries: TranscriptEntry[] = [
        {
          kind: "model_call",
          atMs: 1000,
          model: "claude-opus-4",
          tokens: 50_000,
          costUsd: 0.5,
          durationMs: 400,
          spanId: "llm-1",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 20_000,
          cacheCreationTokens: 30_000,
        },
        {
          kind: "assistant_message",
          atMs: 1500,
          text: "On it.",
          model: "claude-opus-4",
        },
      ];
      renderView({ entries: growingEntries });
      expect(
        screen.getByText("Context growing: 50.0K tok"),
      ).toBeInTheDocument();
    });
  });

  describe("given a call that rebuilt the cache instead of reusing it", () => {
    it("flags it as a dead site with the tokens re-sent and what was cached", () => {
      const rebuildEntries: TranscriptEntry[] = [
        {
          kind: "model_call",
          atMs: 1000,
          model: "claude-opus-4",
          tokens: 10_000,
          costUsd: 0.1,
          durationMs: 400,
          spanId: "llm-1",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 10_000,
        },
        {
          kind: "assistant_message",
          atMs: 1200,
          text: "Reading the repo.",
          model: "claude-opus-4",
        },
        {
          kind: "model_call",
          atMs: 2000,
          model: "claude-opus-4",
          tokens: 6_000,
          costUsd: 0.08,
          durationMs: 400,
          spanId: "llm-2",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          // >=1000 tokens AND >=50% of the 10k the previous call had cached.
          cacheCreationTokens: 6_000,
        },
        {
          kind: "assistant_message",
          atMs: 2200,
          text: "Continuing.",
          model: "claude-opus-4",
        },
      ];
      renderView({ entries: rebuildEntries });
      expect(
        screen.getByText(
          "Cache rebuilt: 6.0K tok re-sent instead of reusing 10.0K tok cached",
        ),
      ).toBeInTheDocument();
    });
  });
});
