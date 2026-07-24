/**
 * @vitest-environment jsdom
 *
 * The strip is the only place that decides which tab is active and whether the
 * row is crowded. `PromptBrowserTab` is thoroughly tested against those two
 * props, but nothing proved the strip hands it the right ones: swap them and
 * every tab test still passes while the close buttons appear on exactly the
 * wrong tabs.
 *
 * Only the strip's collaborators are mocked — the overflow measurement, which
 * jsdom cannot perform, and the switcher, which has its own suite. The tabs
 * render for real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { PromptTabStrip } from "../PromptTabStrip";
import { usePromptBrowserTabController } from "../tab/usePromptBrowserTabController";
import { DraggableTabsBrowser } from "../ui/DraggableTabsBrowser";
import { useTabId } from "../ui/TabContext";
import { useIsOverflowing } from "../useIsOverflowing";

vi.mock("../useIsOverflowing", () => ({ useIsOverflowing: vi.fn() }));

vi.mock("../switcher/PromptTabSwitcher", () => ({
  PromptTabSwitcher: ({
    isStripOverflowing,
  }: {
    isStripOverflowing: boolean;
  }) => (
    <div data-testid="switcher" data-overflowing={String(isStripOverflowing)} />
  ),
}));

// The real controller reads the tab store and the prompt queries. The strip
// cares about neither; it cares that each tab gets its own title and flags.
vi.mock("../tab/usePromptBrowserTabController", () => ({
  usePromptBrowserTabController: vi.fn(),
}));

const overflowOf = vi.mocked(useIsOverflowing);
const controllerOf = vi.mocked(usePromptBrowserTabController);

const TABS = [{ id: "summarizer" }, { id: "classifier" }] as unknown as Tab[];

function renderStrip({ isStripOverflowing }: { isStripOverflowing: boolean }) {
  overflowOf.mockReturnValue(isStripOverflowing);

  return render(
    <ChakraProvider value={defaultSystem}>
      <DraggableTabsBrowser.Root onTabMove={vi.fn()}>
        <DraggableTabsBrowser.Window windowId="window-1" activeTabId="summarizer">
          <DraggableTabsBrowser.TabBar tabIds={TABS.map((tab) => tab.id)}>
            <PromptTabStrip
              tabs={TABS}
              activeTabId="summarizer"
              isActiveWindow
              onSelectTab={vi.fn()}
            />
          </DraggableTabsBrowser.TabBar>
        </DraggableTabsBrowser.Window>
      </DraggableTabsBrowser.Root>
    </ChakraProvider>,
  );
}

const closeActionFor = (name: string) =>
  screen.queryByRole("button", { name: `Close ${name}` });

beforeEach(() => {
  // Each tab names itself after its own id, so the close labels tell them apart.
  controllerOf.mockImplementation(() => {
    const tabId = useTabId();
    return {
      tab: { id: tabId },
      title: tabId,
      hasUnsavedChanges: false,
      handleClose: vi.fn(),
      versionNumber: 1,
      latestVersion: 1,
      isOutdated: false,
      handleUpgrade: vi.fn(),
      showVersionBadge: false,
    } as unknown as ReturnType<typeof usePromptBrowserTabController>;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PromptTabStrip", () => {
  describe("given the strip has run out of room", () => {
    it("keeps the close action on the active tab and takes it off the others", () => {
      renderStrip({ isStripOverflowing: true });

      expect(closeActionFor("summarizer")).toBeInTheDocument();
      expect(closeActionFor("classifier")).not.toBeInTheDocument();
    });

    it("tells the switcher the strip is overflowing", () => {
      renderStrip({ isStripOverflowing: true });

      expect(screen.getByTestId("switcher")).toHaveAttribute(
        "data-overflowing",
        "true",
      );
    });
  });

  describe("given every tab still fits in the strip", () => {
    it("keeps the close action on every tab", () => {
      renderStrip({ isStripOverflowing: false });

      expect(closeActionFor("summarizer")).toBeInTheDocument();
      expect(closeActionFor("classifier")).toBeInTheDocument();
    });

    it("tells the switcher the strip is not overflowing", () => {
      renderStrip({ isStripOverflowing: false });

      expect(screen.getByTestId("switcher")).toHaveAttribute(
        "data-overflowing",
        "false",
      );
    });
  });
});
