/**
 * @vitest-environment jsdom
 *
 * Editing happens in the Trace and Summary views. Conversation, Usage and
 * Terminal replay an agent run rather than showing the trace's own spans, so
 * they stay unavailable, and say why, until the reviewer finishes.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({
    children,
    content,
  }: {
    children: ReactNode;
    content: ReactNode;
  }) => (
    <div>
      {children}
      <span>{content}</span>
    </div>
  ),
}));

const { ModeSwitch } = await import("../ModeSwitch");

const EDITING_REASON = "Finish editing to switch views";

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

describe("given a reviewer correcting a trace", () => {
  describe("when the tabs render", () => {
    /** @scenario "Views that cannot be edited are unavailable while editing" */
    it("cannot open the conversation, usage or terminal views", () => {
      const { onViewModeChange } = renderTabs({ isEditing: true });

      for (const label of ["Conversation", "Usage", "Terminal"]) {
        fireEvent.click(tab(label));
      }

      expect(onViewModeChange).not.toHaveBeenCalled();
    });

    /** @scenario "Views that cannot be edited are unavailable while editing" */
    it("explains that the correction has to be finished first", () => {
      renderTabs({ isEditing: true });

      expect(screen.getAllByText(EDITING_REASON)).toHaveLength(3);
    });

    /** @scenario "Views that cannot be edited are unavailable while editing" */
    it("keeps the views that can be edited open", () => {
      const { onViewModeChange } = renderTabs({ isEditing: true });

      fireEvent.click(tab("Summary"));

      expect(onViewModeChange).toHaveBeenCalledWith("summary");
    });
  });
});

describe("given a reviewer reading a trace", () => {
  describe("when the tabs render", () => {
    /** @scenario "Views that cannot be edited are unavailable while editing" */
    it("opens every view", () => {
      const { onViewModeChange } = renderTabs({ isEditing: false });

      fireEvent.click(tab("Conversation"));

      expect(onViewModeChange).toHaveBeenCalledWith("conversation");
      expect(screen.queryByText(EDITING_REASON)).not.toBeInTheDocument();
    });
  });
});
