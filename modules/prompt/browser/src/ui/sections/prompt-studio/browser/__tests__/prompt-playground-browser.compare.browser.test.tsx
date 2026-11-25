/**
 * Compare mode in the prompt studio at 1280 wide: two panes share the room the
 * studio leaves them, and neither runs off the edge of the viewport. Real
 * layout, which jsdom cannot measure.
 */

import { Box, HStack } from "@langwatch/design-system/primitives";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

const store = vi.hoisted(() => {
  const tab = (id: string) => ({ id, data: {} });
  return {
    state: {
      windows: [
        { id: "w1", activeTabId: "t1", tabs: [tab("t1")] },
        { id: "w2", activeTabId: "t2", tabs: [tab("t2")] },
      ],
      activeWindowId: "w1",
      splitTab: () => undefined,
      moveTab: () => undefined,
      setActiveTab: () => undefined,
      setActiveWindow: () => undefined,
    },
  };
});

vi.mock("../../../../../features/tabs/behavior/use-prompt-tabs-browser-store.ts", () => ({
  useDraggableTabsBrowserStore: (select: (state: typeof store.state) => unknown) =>
    select(store.state),
}));
vi.mock("../prompt-tab-strip.tsx", () => ({
  PromptTabStrip: () => <Box flex={1} minWidth={0} />,
}));
vi.mock("../experiment-from-playground-button.tsx", () => ({
  ExperimentFromPlaygroundButton: () => null,
}));
vi.mock("../../sidebar/add-prompt-button.tsx", () => ({
  AddPromptButton: () => (
    <button type="button" aria-label="New prompt">
      +
    </button>
  ),
}));
vi.mock("../window/prompt-browser-window-content.tsx", () => ({
  PromptBrowserWindowContent: () => <Box data-testid="pane-content" height="full" />,
}));

import { PromptPlaygroundBrowser } from "../prompt-playground-browser.tsx";

/** The shell's sidebar plus the prompt list: what sits left of the studio's main area. */
const LEFT_OF_STUDIO_PX = 212 + 250;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => cleanup());

function renderStudio() {
  return renderWithDesignSystem(
    <Box marginLeft={`${LEFT_OF_STUDIO_PX}px`} height="600px" minWidth={0}>
      <HStack width="full" height="full" gap={0} overflowX="scroll">
        <PromptPlaygroundBrowser />
      </HStack>
    </Box>,
  );
}

describe("given two prompts side by side at 1280 wide", () => {
  describe("when the studio renders them", () => {
    /** @scenario "Compare mode shares the studio width between its panes" */
    it("keeps both panes inside the viewport and the page from scrolling sideways", () => {
      renderStudio();

      const panes = screen.getAllByTestId("pane-content");
      expect(panes).toHaveLength(2);
      for (const pane of panes) {
        const box = pane.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(LEFT_OF_STUDIO_PX);
        expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    });

    /** @scenario "Compare mode shares the studio width between its panes" */
    it("gives both panes the same width", () => {
      renderStudio();

      const [first, second] = screen.getAllByTestId("pane-content");
      const gap = (first as HTMLElement).offsetWidth - (second as HTMLElement).offsetWidth;
      expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    });
  });
});
