/**
 * @vitest-environment jsdom
 *
 * Regression test for GitHub issue #5454: inactive tabs in the Prompt
 * Playground stayed mounted in the DOM instead of unmounting.
 *
 * Before the fix, DraggableTabsBrowser rendered a Chakra v3 `Tabs.Root`
 * (Ark UI under the hood) with no `lazyMount`/`unmountOnExit` props, so Ark
 * UI mounted every `Tabs.Content` panel and only toggled the `hidden`
 * attribute on inactive ones instead of unmounting them. This test guards
 * against that regression now that both props are set.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraggableTabsBrowser } from "../ui/DraggableTabsBrowser";

describe("DraggableTabsBrowser", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when a window has multiple tabs and one is inactive", () => {
    function renderTwoTabWindow() {
      return render(
        <ChakraProvider value={defaultSystem}>
          <DraggableTabsBrowser.Root onTabMove={vi.fn()}>
            <DraggableTabsBrowser.Group
              groupId="window-1"
              activeTabId="tab-1"
              onTabChange={vi.fn()}
            >
              <DraggableTabsBrowser.TabBar tabIds={["tab-1", "tab-2"]}>
                <DraggableTabsBrowser.Tab id="tab-1">
                  <DraggableTabsBrowser.Trigger value="tab-1">
                    Tab 1
                  </DraggableTabsBrowser.Trigger>
                </DraggableTabsBrowser.Tab>
                <DraggableTabsBrowser.Tab id="tab-2">
                  <DraggableTabsBrowser.Trigger value="tab-2">
                    Tab 2
                  </DraggableTabsBrowser.Trigger>
                </DraggableTabsBrowser.Tab>
              </DraggableTabsBrowser.TabBar>
              <DraggableTabsBrowser.Content value="tab-1">
                <div data-testid="tab-1-content">Tab 1 content</div>
              </DraggableTabsBrowser.Content>
              <DraggableTabsBrowser.Content value="tab-2">
                <div data-testid="tab-2-content">Tab 2 content</div>
              </DraggableTabsBrowser.Content>
            </DraggableTabsBrowser.Group>
          </DraggableTabsBrowser.Root>
        </ChakraProvider>,
      );
    }

    it("keeps the active tab's content mounted", () => {
      renderTwoTabWindow();

      expect(screen.getByTestId("tab-1-content")).toBeInTheDocument();
    });

    it("unmounts the inactive tab's content instead of just hiding it", () => {
      renderTwoTabWindow();

      // Content for the inactive tab ("tab-2") must not exist in the DOM at
      // all. Ark UI's default behavior only sets a `hidden` attribute on the
      // panel, which keeps the node present here and fails this assertion.
      expect(screen.queryByTestId("tab-2-content")).not.toBeInTheDocument();
    });
  });
});
