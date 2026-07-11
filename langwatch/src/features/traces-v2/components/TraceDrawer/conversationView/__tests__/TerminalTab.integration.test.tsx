/**
 * @vitest-environment jsdom
 *
 * The Terminal view is a coding-agent-only surface: a terminal-origin (Claude
 * Code) conversation gets a "Terminal" tab that renders the CLI-style
 * TerminalView, while an ordinary LLM conversation never offers it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { TraceListItem } from "../../../../types/trace";

// Boundaries the conversation view reaches through — stubbed so the test
// exercises the mode wiring, not the data layer.
const turnsRef: { current: TraceListItem[] } = { current: [] };
vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({
    data: { items: turnsRef.current },
    isLoading: false,
  }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));
vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));
vi.mock("../../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: () => undefined }),
}));
// Leaf views the thread/annotations modes render — irrelevant to the tab
// gating and they reach for tRPC, so stub them out.
vi.mock("../ChatTurnRow", () => ({ ChatTurnRow: () => null }));
vi.mock("../AnnotationsView", () => ({ AnnotationsView: () => null }));
vi.mock("../SystemPromptBanner", () => ({ SystemPromptBanner: () => null }));

import { ConversationView } from "../ConversationView";

function trace(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 1_000,
    name: "turn",
    serviceName: "my-app",
    durationMs: 10,
    totalCost: 0.01,
    nonBilledCost: 0,
    totalTokens: 100,
    models: ["claude-sonnet-4"],
    labels: [],
    status: "ok",
    spanCount: 1,
    sizeBytes: 0,
    input: null,
    output: null,
    origin: "application",
    evaluations: [],
    events: [],
    ...over,
  };
}

const terminalTurn = trace({
  serviceName: "claude-code",
  origin: "coding_agent",
  input: JSON.stringify([
    { role: "system", content: "You are Claude Code." },
    { role: "user", content: "check git status" },
  ]),
  output: JSON.stringify([
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking the working tree." },
        {
          type: "tool_use",
          id: "t1",
          name: "Bash",
          input: { command: "git status" },
        },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "On branch main" },
      ],
    },
  ]),
});

const normalTurn = trace({
  traceId: "n1",
  input: JSON.stringify([{ role: "user", content: "what is 2 + 2?" }]),
  output: JSON.stringify([{ role: "assistant", content: "4" }]),
});

function renderView() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationView conversationId="conv-1" currentTraceId="t1" />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  turnsRef.current = [];
});

describe("Terminal tab in the conversation view", () => {
  describe("given a terminal-origin (Claude Code) conversation", () => {
    it("offers the Terminal tab", () => {
      turnsRef.current = [terminalTurn];
      renderView();
      expect(screen.getByText("terminal")).toBeInTheDocument();
    });

    it("renders the TerminalView when the Terminal tab is selected", () => {
      turnsRef.current = [terminalTurn];
      renderView();

      // Not yet shown — the default mode is the thread view.
      expect(screen.queryByText("check git status")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("terminal"));

      // The CLI recreation: the user's prompt and the timeline scrubber.
      expect(screen.getByText("check git status")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Scrub session timeline"),
      ).toBeInTheDocument();
    });
  });

  describe("given an ordinary LLM conversation", () => {
    it("does not offer the Terminal tab", () => {
      turnsRef.current = [normalTurn];
      renderView();

      expect(screen.getByText("thread")).toBeInTheDocument();
      expect(screen.queryByText("terminal")).not.toBeInTheDocument();
    });
  });
});
