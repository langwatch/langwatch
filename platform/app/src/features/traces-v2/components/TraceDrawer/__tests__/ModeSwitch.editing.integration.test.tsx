/**
 * @vitest-environment jsdom
 *
 * Which views a reviewer annotating a trace can still open. Usage and Terminal
 * replay an agent run rather than showing the trace's own spans, so they stay
 * unavailable, and say why, until the reviewer finishes. The Conversation is
 * where commenting on a turn happens, so it stays open.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      {children}
      <span>{content}</span>
    </div>
  ),
}));

const { ModeSwitch } = await import("../ModeSwitch");

const EDITING_REASON = "Finish annotating to switch views";

function renderTabs({ isEditing }: { isEditing: boolean }) {
  const onViewModeChange = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <ModeSwitch
        viewMode="trace"
        onViewModeChange={onViewModeChange}
        hasConversation
        showTerminal
        isEditing={isEditing}
      />
    </ChakraProvider>,
  );
  return { onViewModeChange };
}

const tab = (label: string) => screen.getByText(label);

afterEach(cleanup);

describe("given a reviewer annotating a trace", () => {
  describe("when the tabs render", () => {
    /** @scenario "Views the pass cannot act on are unavailable while annotating" */
    it("cannot open the usage or terminal views", () => {
      const { onViewModeChange } = renderTabs({ isEditing: true });

      for (const label of ["Usage", "Terminal"]) {
        fireEvent.click(tab(label));
      }

      expect(onViewModeChange).not.toHaveBeenCalled();
    });

    /** @scenario "Views the pass cannot act on are unavailable while annotating" */
    it("explains that the pass has to be finished first", () => {
      renderTabs({ isEditing: true });

      expect(screen.getAllByText(EDITING_REASON)).toHaveLength(2);
    });

    /** @scenario "Views the pass cannot act on are unavailable while annotating" */
    it("keeps the views the pass can act on open", () => {
      const { onViewModeChange } = renderTabs({ isEditing: true });

      fireEvent.click(tab("Summary"));

      expect(onViewModeChange).toHaveBeenCalledWith("summary");
    });

    /** @scenario "The conversation stays reachable while annotating" */
    it("opens the conversation, where commenting on a turn happens", () => {
      const { onViewModeChange } = renderTabs({ isEditing: true });

      fireEvent.click(tab("Conversation"));

      expect(onViewModeChange).toHaveBeenCalledWith("conversation");
    });
  });
});

describe("given a reviewer reading a trace", () => {
  describe("when the tabs render", () => {
    /** @scenario "Views the pass cannot act on are unavailable while annotating" */
    it("opens every view", () => {
      const { onViewModeChange } = renderTabs({ isEditing: false });

      for (const [label, mode] of [
        ["Conversation", "conversation"],
        ["Usage", "session"],
        ["Terminal", "terminal"],
      ] as const) {
        fireEvent.click(tab(label));

        expect(onViewModeChange).toHaveBeenCalledWith(mode);
      }
      expect(screen.queryByText(EDITING_REASON)).not.toBeInTheDocument();
    });
  });
});
