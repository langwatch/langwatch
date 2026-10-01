/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Tab, useIsOverflowing, useTabId } from "../../studio-internals.ts";
import type * as studioInternalsModule from "../../studio-internals.ts";
import { DraggableTabsBrowser } from "../draggable-tabs-browser.tsx";
import { PromptTabStrip } from "../prompt-tab-strip.tsx";
import { usePromptBrowserTabController } from "../tab/use-prompt-browser-tab-controller.ts";

vi.mock("../../studio-internals.ts", async () => {
  const actual = await vi.importActual<typeof studioInternalsModule>("../../studio-internals");
  return { ...actual, useIsOverflowing: vi.fn() };
});

vi.mock("../prompt-tab-switcher-panel.tsx", () => ({
  PromptTabSwitcher: ({ isStripOverflowing }: { isStripOverflowing: boolean }) => (
    <div data-testid="switcher" data-overflowing={String(isStripOverflowing)} />
  ),
}));

// The real controller reads the tab store and the prompt queries. The strip
// cares about neither; it cares that each tab gets its own title and flags.
vi.mock("../tab/use-prompt-browser-tab-controller.ts", () => ({
  usePromptBrowserTabController: vi.fn(),
}));

const overflowOf = vi.mocked(useIsOverflowing);
const controllerOf = vi.mocked(usePromptBrowserTabController);

function tabNamed(id: string): Tab {
  return {
    id,
    data: {
      chat: { initialMessagesFromSpanData: [] },
      form: { currentValues: {} },
      meta: { title: null },
      variableValues: {},
    },
  };
}

const TABS = [tabNamed("summarizer"), tabNamed("classifier")];

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

const closeActionFor = (name: string) => screen.queryByRole("button", { name: `Close ${name}` });

beforeEach(() => {
  // Each tab names itself after its own id, so the close labels tell them apart.
  controllerOf.mockImplementation(() => {
    const tabId = useTabId();
    return {
      tab: tabNamed(tabId),
      title: tabId,
      hasUnsavedChanges: false,
      handleClose: vi.fn(),
      versionNumber: 1,
      latestVersion: 1,
      isOutdated: false,
      handleUpgrade: vi.fn(),
      showVersionBadge: false,
    };
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

      expect(screen.getByTestId("switcher")).toHaveAttribute("data-overflowing", "true");
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

      expect(screen.getByTestId("switcher")).toHaveAttribute("data-overflowing", "false");
    });
  });
});
