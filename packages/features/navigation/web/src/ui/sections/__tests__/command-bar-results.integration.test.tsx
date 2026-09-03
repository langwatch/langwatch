/**
 * @vitest-environment jsdom
 *
 * The results panel's own top edge. The raised bar keeps the field and the
 * list in one card, where `showTopDivider` marks the boundary between them.
 * The home mounts the same results list as its own panel, and there the line
 * would draw a second edge a few pixels inside the panel's own — so the
 * inline surface passes `showTopDivider={false}` (see command-palette.tsx).
 *
 * Ported from platform/app/src/features/command-bar/__tests__/CommandPaletteInlinePanel.integration.test.tsx
 * (origin/main), narrowed from mounting the whole `CommandPalette` (which now
 * pulls in `useNavigationHost`, `useCommandBarItems`, `useRecentItems` and
 * several other tRPC-backed collaborators unrelated to this scenario) down to
 * the leaf presentational component that actually owns `showTopDivider` and
 * the border it draws.
 * See specs/home/langy-home.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationHostProvider } from "../../../model/navigation-host";
import { StubNavigationHost } from "../../../testing";
import { CommandBarResults } from "../command-bar-results";

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
