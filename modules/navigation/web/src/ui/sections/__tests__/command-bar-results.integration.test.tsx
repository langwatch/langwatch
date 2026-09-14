/**
 * @vitest-environment jsdom
 *
 * Results panel's top edge with showTopDivider. Ported from platform/app;
 * narrowed to this leaf presentational component.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationHostProvider } from "../../../model/navigation-host.ts";
import { StubNavigationHost } from "../../../testing.tsx";
import { CommandBarResults } from "../command-bar-results.tsx";

const baseProps = {
  query: "",
  allItems: [],
  selectedIndex: -1,
  onSelect: vi.fn(),
  onMouseEnter: vi.fn(),
  filteredNavigation: [],
  filteredActions: [],
  filteredSupport: [],
  filteredTheme: [],
  filteredPage: [],
  searchResults: [],
  filteredProjects: [],
  searchInTracesItem: null,
  searchInDocsItem: null,
  idResult: null,
  recentItemsLimited: [],
  easterEggItem: null,
  askLangyItem: null,
  isLoading: false,
};

function renderResults(showTopDivider: boolean) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <NavigationHostProvider value={StubNavigationHost.create({})}>
        <CommandBarResults {...baseProps} showTopDivider={showTopDivider} />
      </NavigationHostProvider>
    </ChakraProvider>,
  );
}

afterEach(() => cleanup());

describe("the command palette results panel's own edge", () => {
  describe("when the home mounts the palette inline", () => {
    /** @scenario The results panel draws one edge, not two */
    it("draws no line above the first group", () => {
      renderResults(false);

      expect(screen.getByTestId("command-bar-results")).not.toHaveStyle({
        borderTopWidth: "1px",
      });
    });
  });

  describe("when the raised bar mounts the palette", () => {
    /** @scenario The results panel draws one edge, not two */
    it("keeps the line that separates the list from the field above it", () => {
      renderResults(true);

      expect(screen.getByTestId("command-bar-results")).toHaveStyle({
        borderTopWidth: "1px",
      });
    });
  });
});
