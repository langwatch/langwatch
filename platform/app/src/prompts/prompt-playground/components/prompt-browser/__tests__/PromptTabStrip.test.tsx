/**
 * @vitest-environment jsdom
 *
 * Where the tab strip sits relative to the card it opens.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { PromptTabStrip } from "../PromptTabStrip";
import { DraggableTabsBrowser } from "../ui/DraggableTabsBrowser";

// Titles by tab id, so the mocked controller below can answer per tab the way
// the real one does.
const { titles } = vi.hoisted(() => ({
  titles: { current: {} as Record<string, string> },
}));

// A tab renders a real prompt summary in the app, which reaches the store and
// tRPC. This suite is about the strip around the tabs, so the summary is given.
vi.mock("../tab/usePromptBrowserTabController", async () => {
  const { useTabId } =
    await vi.importActual<typeof import("../ui/TabContext")>(
      "../ui/TabContext",
    );
  return {
    usePromptBrowserTabController: () => {
      const tabId = useTabId();
      return {
        tab: { id: tabId },
        title: titles.current[tabId] ?? "",
        hasUnsavedChanges: false,
        handleClose: vi.fn(),
        versionNumber: 1,
        latestVersion: 1,
        isOutdated: false,
        handleUpgrade: vi.fn(),
        showVersionBadge: false,
      };
    },
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const asTab = (id: string): Tab => ({ id }) as unknown as Tab;

function renderStrip(ids: string[]) {
  const tabs = ids.map(asTab);
  return render(
    <ChakraProvider value={defaultSystem}>
      <DraggableTabsBrowser.Root onTabMove={vi.fn()}>
        <DraggableTabsBrowser.Window windowId="w1" activeTabId={ids[0]}>
          <DraggableTabsBrowser.TabBar tabIds={ids}>
            <PromptTabStrip
              tabs={tabs}
              activeTabId={ids[0]}
              isActiveWindow
              onSelectTab={vi.fn()}
            />
          </DraggableTabsBrowser.TabBar>
          <DraggableTabsBrowser.Panel />
        </DraggableTabsBrowser.Window>
      </DraggableTabsBrowser.Root>
    </ChakraProvider>,
  );
}

describe("the prompt tab strip", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    titles.current = { "tab-1": "search-agent", "tab-2": "summariser" };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("when a prompt is open", () => {
    /** @scenario The tab of the prompt on screen is attached to the card it opens */
    it("stands outside the card rather than inside it", () => {
      const { container } = renderStrip(["tab-1", "tab-2"]);

      const card = screen.getByTestId("prompt-card");
      const tabList = container.querySelector('[role="tablist"]');
      expect(tabList).not.toBeNull();
      expect(card.contains(tabList)).toBe(false);
    });

    /** @scenario The tab of the prompt on screen is attached to the card it opens */
    it("overlaps the card so the active tab meets it with no rule between", () => {
      const { container } = renderStrip(["tab-1", "tab-2"]);

      const tabList = container.querySelector('[role="tablist"]');
      // The bar the strip lives in is pulled down over the card's top border by
      // exactly that border's width; the active tab, which paints the card's
      // own surface, then covers the rule for its own width.
      expect(tabList?.parentElement).toHaveStyle({ marginBottom: "-1px" });
    });

    it("keeps every tab selectable", () => {
      renderStrip(["tab-1", "tab-2"]);

      expect(screen.getAllByRole("tab")).toHaveLength(2);
    });
  });
});
