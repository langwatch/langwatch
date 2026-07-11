/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationTurn } from "../../transcript";
import type { TerminalStep } from "../terminalSession";
import { TerminalView } from "../TerminalView";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const userTurn: ConversationTurn = {
  kind: "user",
  blocks: [{ kind: "text", text: "check git status and bump the version" }],
  toolCalls: [],
  messages: [],
};

const assistantTurn: ConversationTurn = {
  kind: "assistant",
  toolCalls: [],
  messages: [],
  blocks: [
    { kind: "text", text: "Checking the working tree." },
    {
      kind: "tool_use",
      id: "t1",
      name: "Bash",
      input: { command: "git status" },
    },
    {
      kind: "tool_result",
      toolUseId: "t1",
      content: "On branch \x1b[32mmain\x1b[0m\n\tmodified:   file.ts",
      isError: false,
    },
    {
      kind: "tool_use",
      id: "t2",
      name: "Edit",
      input: {
        file_path: "/src/version.ts",
        old_string: "const version = 1;",
        new_string: "const version = 2;",
      },
    },
    {
      kind: "tool_result",
      toolUseId: "t2",
      content: "Applied edit to /src/version.ts",
      isError: false,
    },
  ],
};

const steps: TerminalStep[] = [
  { turn: userTurn, timestamp: 1000, tokens: 0, costUsd: 0 },
  {
    turn: assistantTurn,
    timestamp: 5000,
    tokens: 175,
    costUsd: 0.06,
    model: "claude-opus-4",
  },
];

function renderView() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TerminalView
        steps={steps}
        meta={{ cwd: "/repo" }}
      />
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
      // Diff shows the before/after lines...
      expect(screen.getByText("const version = 1;")).toBeInTheDocument();
      expect(screen.getByText("const version = 2;")).toBeInTheDocument();
      // ...and a +/- stat.
      expect(screen.getByText("+1")).toBeInTheDocument();
      expect(screen.getByText("-1")).toBeInTheDocument();
      // The raw "Applied edit" result text is replaced by the diff.
      expect(container.textContent).not.toContain("Applied edit");
    });
  });

  describe("given per-step token and cost metrics", () => {
    it("shows the cumulative token and cost totals in the timeline HUD", () => {
      renderView();
      expect(screen.getByText("175 tok")).toBeInTheDocument();
      expect(screen.getByText("$0.06")).toBeInTheDocument();
    });

    it("shows a scrub position of the last step by default", () => {
      renderView();
      expect(screen.getByText("step 2/2")).toBeInTheDocument();
    });

    it("renders a timeline slider when there is more than one step", () => {
      renderView();
      expect(screen.getByRole("slider")).toBeInTheDocument();
    });
  });
});
