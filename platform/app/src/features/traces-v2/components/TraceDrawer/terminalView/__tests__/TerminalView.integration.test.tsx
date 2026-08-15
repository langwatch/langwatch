/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import type { TurnDivider } from "../sessionScrollback";
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
      expect(screen.getByText("175 tokens")).toBeInTheDocument();
      expect(screen.getByText("$0.06")).toBeInTheDocument();
    });

    it("shows the step count at the last visible beat by default", () => {
      renderView();
      expect(screen.getByText("step 4/4")).toBeInTheDocument();
    });

    it("counts no step when the agent reported usage but nothing to walk", () => {
      renderView({
        entries: [
          {
            kind: "model_call",
            atMs: 1000,
            model: "claude-opus-5",
            tokens: 212,
            costUsd: 0.1930215,
            durationMs: 2000,
            spanId: "llm-only",
            inputTokens: 2,
            outputTokens: 210,
            cacheReadTokens: 18443,
            cacheCreationTokens: 17854,
          },
        ],
      });

      expect(screen.getByText("step 0/0")).toBeInTheDocument();
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
        screen.getByText("Context growing: 50.0K tokens"),
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
          "Cache rebuilt: 6.0K tokens re-sent instead of reusing 10.0K tokens cached",
        ),
      ).toBeInTheDocument();
    });
  });
  describe("given a session whose system context was captured", () => {
    const systemEntries: TranscriptEntry[] = [
      {
        kind: "system_prompt",
        atMs: 500,
        text: "You are Claude Code. CLAUDE.md says always use pnpm.",
        chars: 52,
      },
      ...entries,
    ];

    /** @scenario "The session's system context is shown once at the top" */
    it("collapses it to one line, with the size a reader is deciding on", () => {
      renderView({ entries: systemEntries });
      expect(
        screen.getByText(
          /session context: 52 chars of system prompt and tools/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/always use pnpm/)).not.toBeInTheDocument();
    });

    describe("when the reader reaches the header with the keyboard", () => {
      it("expands and collapses it, so the context is not pointer-only", async () => {
        const user = userEvent.setup();
        renderView({ entries: systemEntries });
        const header = screen.getByRole("button", { name: /session context/ });

        header.focus();
        await user.keyboard("{Enter}");
        expect(screen.getByText(/always use pnpm/)).toBeInTheDocument();
        expect(header).toHaveAttribute("aria-expanded", "true");

        await user.keyboard(" ");
        expect(screen.queryByText(/always use pnpm/)).not.toBeInTheDocument();
        expect(header).toHaveAttribute("aria-expanded", "false");
      });
    });
  });

  describe("given a session whose earlier turns are still out there", () => {
    describe("when an earlier turn is prepended above the reader", () => {
      /** @scenario "Scrolling up past the top loads the previous turn" */
      it("moves the screen by exactly what arrived, so the row stays under their eyes", () => {
        const view = renderScrollback();
        fakeBox(view.screenEl, { scrollHeight: 1000 });
        scrollTo(view.screenEl, 0);

        prependEarlierTurn(view, { scrollHeight: 1800 });

        expect(view.screenEl.scrollTop).toBe(800);
      });

      it("shows the previous turn's entries above a divider naming the turn", () => {
        const view = renderScrollback();
        fakeBox(view.screenEl, { scrollHeight: 1000 });
        scrollTo(view.screenEl, 0);

        prependEarlierTurn(view, { scrollHeight: 1800 });

        expect(screen.getByText("check git status")).toBeInTheDocument();
        expect(screen.getByText(/turn 5\/12 · /)).toBeInTheDocument();
      });

      /** @scenario "A prepend never yanks the reader to the bottom" */
      it("leaves a turn too short to overflow where it was instead of following the tail", () => {
        const view = renderScrollback();
        // Content shorter than the viewport: the reader is at the bottom of
        // this turn simply by being on it.
        fakeBox(view.screenEl, { scrollHeight: 100 });
        scrollTo(view.screenEl, 0);

        prependEarlierTurn(view, { scrollHeight: 500 });

        expect(view.screenEl.scrollTop).toBe(400);
      });

      it("keeps a row's expanded state with the row it belongs to", async () => {
        const user = userEvent.setup();
        const view = renderScrollback();
        await user.click(
          screen.getByRole("button", { name: /session context/ }),
        );
        expect(screen.getByText(/always use pnpm/)).toBeInTheDocument();

        prependEarlierTurn(view, { scrollHeight: 500 });

        expect(screen.getByText(/always use pnpm/)).toBeInTheDocument();
        expect(screen.queryByText(/always use npm/)).not.toBeInTheDocument();
      });

      /** @scenario "The cumulative footer counts every loaded turn" */
      it("counts the earlier turn's beats in the step count", () => {
        const view = renderScrollback();
        expect(screen.getByText("step 3/3")).toBeInTheDocument();

        prependEarlierTurn(view, { scrollHeight: 500 });

        expect(screen.getByText("step 5/5")).toBeInTheDocument();
      });
    });

    describe("when new output is appended at the bottom", () => {
      it("still follows the tail while the reader is caught up", () => {
        const view = renderScrollback();
        fakeBox(view.screenEl, { scrollHeight: 1000 });
        scrollTo(view.screenEl, 800);

        act(() => {
          fakeBox(view.screenEl, { scrollHeight: 1400 });
          view.rerender({ entries: [...OPENED_TURN, APPENDED_REPLY] });
        });

        expect(view.screenEl.scrollTop).toBe(1400);
      });
    });
  });

  describe("given earlier turns are available above", () => {
    describe("when the reader is within the preload buffer of the top", () => {
      /** @scenario "Earlier turns preload before the reader reaches the top" */
      it("asks for the previous turn before the top is on screen", () => {
        const onLoadEarlier = vi.fn();
        const view = renderScrollback({
          scrollback: { status: "available", earlierCount: 3, onLoadEarlier },
        });
        fakeBox(view.screenEl, { scrollHeight: 1000 });

        // Two viewports of 200px: anything under 400 is inside the buffer.
        scrollTo(view.screenEl, 300);

        expect(onLoadEarlier).toHaveBeenCalled();
      });
    });

    describe("when the reader is beyond the preload buffer", () => {
      it("asks for nothing, because they are still reading this turn", () => {
        const onLoadEarlier = vi.fn();
        const view = renderScrollback({
          scrollback: { status: "available", earlierCount: 3, onLoadEarlier },
        });
        fakeBox(view.screenEl, { scrollHeight: 1000 });

        scrollTo(view.screenEl, 800);
        scrollTo(view.screenEl, 600);

        expect(onLoadEarlier).not.toHaveBeenCalled();
      });
    });

    describe("when a commit lands while the screen is not yet full", () => {
      it("asks for the next turn without any gesture", () => {
        const onLoadEarlier = vi.fn();
        const view = renderScrollback({
          scrollback: { status: "available", earlierCount: 3, onLoadEarlier },
        });
        fakeBox(view.screenEl, { scrollHeight: 100 });

        // A commit re-checks the buffer on its own; no scroll or wheel
        // reaches a screen whose content is too short to emit one.
        act(() => {
          view.rerender({ entries: [...OPENED_TURN] });
        });

        expect(onLoadEarlier).toHaveBeenCalled();
      });
    });

    describe("when a turn is already being read", () => {
      it("asks for nothing more until it lands", () => {
        const onLoadEarlier = vi.fn();
        const view = renderScrollback({
          scrollback: { status: "loading", earlierCount: 3, onLoadEarlier },
        });
        fakeBox(view.screenEl, { scrollHeight: 1000 });

        scrollTo(view.screenEl, 300);
        scrollTo(view.screenEl, 50);

        expect(onLoadEarlier).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the view just opened", () => {
    describe("when the transcript first overflows the screen", () => {
      /** @scenario "Opening a session lands at its latest line" */
      it("lands at the session's latest line", () => {
        const view = renderScrollback();

        act(() => {
          fakeBox(view.screenEl, { scrollHeight: 1000 });
          view.rerender({ entries: [...OPENED_TURN] });
        });

        expect(view.screenEl.scrollTop).toBe(1000);
      });
    });

    describe("when the reader has scrolled themselves", () => {
      it("never jumps them to the end again", () => {
        const view = renderScrollback();
        fakeBox(view.screenEl, { scrollHeight: 1000 });
        scrollTo(view.screenEl, 500);

        act(() => {
          view.rerender({ entries: [...OPENED_TURN] });
        });

        expect(view.screenEl.scrollTop).toBe(500);
      });
    });
  });

  describe("given the top of the screen", () => {
    it("offers the earlier turns with how many are left", () => {
      renderScrollback({
        scrollback: {
          status: "available",
          earlierCount: 3,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(
        screen.getByRole("button", { name: /3 earlier turns, scroll to load/ }),
      ).toBeInTheDocument();
    });

    it("counts a single turn as one turn", () => {
      renderScrollback({
        scrollback: {
          status: "available",
          earlierCount: 1,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(
        screen.getByRole("button", { name: /1 earlier turn, scroll to load/ }),
      ).toBeInTheDocument();
    });

    it("says a turn is being read while it is in flight", () => {
      renderScrollback({
        scrollback: {
          status: "loading",
          earlierCount: 3,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(screen.getByText(/loading earlier turn/)).toBeInTheDocument();
    });

    /** @scenario "A failed earlier-turn load offers a retry" */
    it("states a failed read on one line and tries again when it is clicked", async () => {
      const user = userEvent.setup();
      const onLoadEarlier = vi.fn();
      renderScrollback({
        scrollback: { status: "error", earlierCount: 3, onLoadEarlier },
      });

      const retry = screen.getByRole("button", {
        name: /couldn't load the earlier turn, click to retry/,
      });
      await user.click(retry);

      expect(onLoadEarlier).toHaveBeenCalledTimes(1);
    });

    it("says so when the session runs past what the view can walk", () => {
      renderScrollback({
        scrollback: {
          status: "unavailable",
          earlierCount: 0,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(
        screen.getByText(/longer than the 200 turns the view can walk/),
      ).toBeInTheDocument();
    });

    /** @scenario "Reaching the first turn shows the session start" */
    it("marks the session start once the first turn is on screen", () => {
      renderScrollback({
        entries: [...EARLIER_TURN, ...OPENED_TURN],
        rowKeys: [...EARLIER_KEYS, ...OPENED_KEYS],
        turnDividers: TURN_DIVIDERS,
        banner: {
          agent: "claude_code",
          version: "2.1.207",
          model: "claude-opus-4-8",
          repo: "langwatch/langwatch",
        },
        scrollback: {
          status: "start",
          earlierCount: 0,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(screen.getByText("Claude Code v2.1.207")).toBeInTheDocument();
      expect(screen.getByText("session start")).toBeInTheDocument();
      expect(screen.queryByText(/scroll to load/)).not.toBeInTheDocument();
    });

    /** @scenario "A trace outside any conversation shows no scrollback" */
    it("shows the banner and nothing else for a trace with no session", () => {
      renderScrollback({
        banner: {
          agent: "claude_code",
          version: "2.1.207",
          model: "claude-opus-4-8",
          repo: "langwatch/langwatch",
        },
      });

      expect(screen.getByText("Claude Code v2.1.207")).toBeInTheDocument();
      expect(screen.queryByText(/earlier turn/)).not.toBeInTheDocument();
      expect(screen.queryByText("session start")).not.toBeInTheDocument();
    });
  });

  describe("given the session's earlier turns are not loaded yet", () => {
    /** @scenario "The footer counts the whole session up to the reader's position" */
    it("counts the unloaded turns' tokens and cost into the bottom bar", () => {
      renderView({
        earlierTotals: { tokens: 1_000, costUsd: 1.0 },
        sessionStartAtMs: 500,
        scrollback: {
          status: "available",
          earlierCount: 5,
          onLoadEarlier: vi.fn(),
        },
      });

      // 1,000 tokens and $1.00 above the window, 175 tokens and $0.06 loaded.
      expect(screen.getByText("1.2K tokens")).toBeInTheDocument();
      expect(screen.getByText("$1.06")).toBeInTheDocument();
    });

    it("measures elapsed time from the session's first turn", () => {
      renderView({
        earlierTotals: { tokens: 0, costUsd: 0 },
        sessionStartAtMs: 500,
      });

      // The last entry is at 3,000ms; the session started at 500ms, and the
      // bar rounds to whole seconds the way the sessions table does.
      expect(screen.getByText("3s")).toBeInTheDocument();
    });

    /** @scenario "Loading an earlier turn does not change the footer's totals" */
    it("keeps the totals at the reader's position when an earlier turn lands", () => {
      const view = renderScrollback({
        earlierTotals: { tokens: 175, costUsd: 0.06 },
        sessionStartAtMs: 500,
        scrollback: {
          status: "available",
          earlierCount: 1,
          onLoadEarlier: vi.fn(),
        },
      });
      expect(screen.getByText("175 tokens")).toBeInTheDocument();
      expect(screen.getByText("$0.06")).toBeInTheDocument();

      // The earlier turn lands: its share moves out of the baseline and into
      // the loaded entries, and the bar reads exactly the same.
      act(() => {
        fakeBox(view.screenEl, { scrollHeight: 500 });
        view.rerender({
          entries: [...EARLIER_TURN_WITH_CALL, ...OPENED_TURN],
          rowKeys: [...EARLIER_WITH_CALL_KEYS, ...OPENED_KEYS],
          turnDividers: TURN_DIVIDERS_AFTER_CALL,
          earlierTotals: { tokens: 0, costUsd: 0 },
          scrollback: {
            status: "start",
            earlierCount: 0,
            onLoadEarlier: vi.fn(),
          },
        });
      });

      expect(screen.getByText("175 tokens")).toBeInTheDocument();
      expect(screen.getByText("$0.06")).toBeInTheDocument();
    });
  });

  describe("given the loaded transcript starts mid-session with its context already grown", () => {
    /** @scenario "A context note waits for the call before it" */
    it("draws no context note while the call before it is unknown", () => {
      renderView({
        entries: GROWN_OPENED_TURN,
        scrollback: {
          status: "available",
          earlierCount: 3,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(screen.queryByText(/Context growing/)).not.toBeInTheDocument();
    });

    /** @scenario "A context note below the reader survives earlier turns loading" */
    it("keeps the lines below the reader stable when the earlier turn lands", () => {
      const view = renderScrollback({
        entries: GROWN_OPENED_TURN,
        rowKeys: ["turn-5#0", "turn-5#1"],
        scrollback: {
          status: "available",
          earlierCount: 1,
          onLoadEarlier: vi.fn(),
        },
      });
      expect(screen.queryByText(/Context growing/)).not.toBeInTheDocument();

      // The earlier turn was already in the growing band, so the crossing
      // belongs to it: the note appears up there, and no note materializes at
      // the opened turn below the reader.
      act(() => {
        fakeBox(view.screenEl, { scrollHeight: 500 });
        view.rerender({
          entries: [...GROWN_EARLIER_TURN, ...GROWN_OPENED_TURN],
          rowKeys: ["turn-4#0", "turn-4#1", "turn-5#0", "turn-5#1"],
          turnDividers: new Map([
            [
              GROWN_EARLIER_TURN.length,
              { turnNumber: 5, turnCount: 5, atMs: 5000 },
            ],
          ]),
          scrollback: {
            status: "start",
            earlierCount: 0,
            onLoadEarlier: vi.fn(),
          },
        });
      });

      expect(
        screen.getByText("Context growing: 52.0K tokens"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Context growing: 60.0K tokens"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the session's turn list is still being read", () => {
    it("offers nothing at the top until it resolves", () => {
      renderScrollback({
        banner: {
          agent: "claude_code",
          version: "2.1.207",
          model: "claude-opus-4-8",
          repo: "langwatch/langwatch",
        },
        scrollback: {
          status: "pending",
          earlierCount: 0,
          onLoadEarlier: vi.fn(),
        },
      });

      expect(screen.queryByText(/Claude Code v/)).not.toBeInTheDocument();
      expect(screen.queryByText(/earlier turn/)).not.toBeInTheDocument();
    });
  });

  describe("given a user message an agent injected a block into", () => {
    const taskNotification = [
      "<task-notification>",
      "  <summary>Monitor event: PR watch: CI + comments</summary>",
      "  <detail>2 new comments on langwatch#4711</detail>",
      "</task-notification>",
    ].join("\n");

    function messageEntries(text: string): TranscriptEntry[] {
      return [{ kind: "user_prompt", atMs: 1000, text, chars: text.length }];
    }

    /** @scenario "A task notification collapses to one gray line naming its summary" */
    it("collapses it to one note naming its summary, with no prompt caret", () => {
      const { container } = renderView({
        entries: messageEntries(taskNotification),
      });

      expect(
        screen.getByRole("button", {
          name: /task notification: Monitor event: PR watch: CI \+ comments/,
        }),
      ).toBeInTheDocument();
      expect(container.textContent).not.toContain("<task-notification>");
      // The only caret left is the bottom bar's own input line.
      expect(container.textContent?.match(/❯/g)).toHaveLength(1);
    });

    it("shows the block as it arrived once the note is opened", async () => {
      const user = userEvent.setup();
      renderView({ entries: messageEntries(taskNotification) });

      const note = screen.getByRole("button", { name: /task notification/ });
      await user.click(note);

      expect(note).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByText(/2 new comments on langwatch#4711/),
      ).toBeInTheDocument();
    });

    /** @scenario "A mixed message keeps the human words as the prompt" */
    it("keeps the words the human typed as the prompt under the note", () => {
      renderView({
        entries: messageEntries(
          "<system-reminder>Background task finished.</system-reminder>\n\nnow ship it",
        ),
      });

      expect(
        screen.getByRole("button", { name: /system reminder/ }),
      ).toBeInTheDocument();
      expect(screen.getByText("now ship it")).toBeInTheDocument();
    });
  });
});

/** A viewport tall enough that "at the bottom" means something. */
const VIEWPORT_HEIGHT = 200;

const OPENED_TURN: TranscriptEntry[] = [
  {
    kind: "system_prompt",
    atMs: 5000,
    text: "You are Claude Code. CLAUDE.md says always use pnpm.",
    chars: 52,
  },
  { kind: "user_prompt", atMs: 5100, text: "bump the version", chars: 16 },
  {
    kind: "assistant_message",
    atMs: 5200,
    text: "Bumped to 2.",
    model: "claude-opus-4",
  },
];
const OPENED_KEYS = ["turn-5#0", "turn-5#1", "turn-5#2"];

const EARLIER_TURN: TranscriptEntry[] = [
  {
    kind: "system_prompt",
    atMs: 1000,
    text: "You are Claude Code. CLAUDE.md says always use npm.",
    chars: 52,
  },
  { kind: "user_prompt", atMs: 1100, text: "check git status", chars: 16 },
];
const EARLIER_KEYS = ["turn-4#0", "turn-4#1"];

/** The boundary the merge puts at the opened turn's first entry. */
const TURN_DIVIDERS: ReadonlyMap<number, TurnDivider> = new Map([
  [EARLIER_TURN.length, { turnNumber: 5, turnCount: 12, atMs: 5000 }],
]);

const APPENDED_REPLY: TranscriptEntry = {
  kind: "assistant_message",
  atMs: 5300,
  text: "Pushed.",
  model: "claude-opus-4",
};

/** An earlier turn that carries the model call the baseline covered. */
const EARLIER_TURN_WITH_CALL: TranscriptEntry[] = [
  { kind: "user_prompt", atMs: 1100, text: "check git status", chars: 16 },
  {
    kind: "model_call",
    atMs: 1200,
    model: "claude-opus-4",
    tokens: 175,
    costUsd: 0.06,
    durationMs: 400,
    spanId: "llm-1200",
    inputTokens: 150,
    outputTokens: 25,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
];
const EARLIER_WITH_CALL_KEYS = ["turn-4#0", "turn-4#1"];
const TURN_DIVIDERS_AFTER_CALL: ReadonlyMap<number, TurnDivider> = new Map([
  [EARLIER_TURN_WITH_CALL.length, { turnNumber: 5, turnCount: 5, atMs: 5000 }],
]);

/** An opened turn whose context is already inside the "growing" band. */
const GROWN_OPENED_TURN: TranscriptEntry[] = [
  {
    kind: "model_call",
    atMs: 5000,
    model: "claude-opus-4",
    tokens: 300,
    costUsd: 0.1,
    durationMs: 400,
    spanId: "llm-5000",
    inputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 59_000,
    cacheCreationTokens: 1_000,
  },
  {
    kind: "assistant_message",
    atMs: 5100,
    text: "Context is big.",
    model: "claude-opus-4",
  },
];

/** The turn before it, whose context had already crossed into the band. */
const GROWN_EARLIER_TURN: TranscriptEntry[] = [
  {
    kind: "model_call",
    atMs: 4000,
    model: "claude-opus-4",
    tokens: 250,
    costUsd: 0.08,
    durationMs: 400,
    spanId: "llm-4000",
    inputTokens: 150,
    outputTokens: 100,
    cacheReadTokens: 22_000,
    cacheCreationTokens: 30_000,
  },
  {
    kind: "assistant_message",
    atMs: 4100,
    text: "Working.",
    model: "claude-opus-4",
  },
];

/**
 * jsdom has no layout engine, so `scrollHeight` and `clientHeight` are a hard
 * zero and the anchoring maths has nothing to work with. Drive the geometry by
 * hand and let the view do exactly what it does in a browser: read the numbers,
 * work out what moved, and set `scrollTop`.
 */
function fakeBox(
  el: HTMLElement,
  {
    scrollHeight,
    clientHeight = VIEWPORT_HEIGHT,
  }: { scrollHeight: number; clientHeight?: number },
) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
}

/** Move the screen the way a wheel or a trackpad would. */
function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
    fireEvent.scroll(el);
  });
}

type ViewProps = Partial<React.ComponentProps<typeof TerminalView>>;

function renderScrollback(props: ViewProps = {}) {
  const tree = (extra: ViewProps) => (
    <ChakraProvider value={defaultSystem}>
      <TerminalView
        entries={OPENED_TURN}
        rowKeys={OPENED_KEYS}
        {...props}
        {...extra}
      />
    </ChakraProvider>
  );
  const view = render(tree({}));
  return {
    screenEl: screen.getByTestId("terminal-screen"),
    rerender: (extra: ViewProps) => view.rerender(tree(extra)),
  };
}

/** The earlier turn landing above the reader, height and all, in one commit. */
function prependEarlierTurn(
  view: ReturnType<typeof renderScrollback>,
  { scrollHeight }: { scrollHeight: number },
) {
  act(() => {
    fakeBox(view.screenEl, { scrollHeight });
    view.rerender({
      entries: [...EARLIER_TURN, ...OPENED_TURN],
      rowKeys: [...EARLIER_KEYS, ...OPENED_KEYS],
      turnDividers: TURN_DIVIDERS,
    });
  });
}
