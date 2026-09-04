/**
 * @vitest-environment jsdom
 *
 * The legacy Traces page is gone from the sidebar; Trace Explorer is the
 * project menu's only traces destination.
 *
 * @see specs/traces-v2/default-drawer-routing.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationProject } from "../../../model/navigation-host";
import { WithStubNavigationHost } from "../../../testing";
import { MainMenuSections } from "../main-menu";

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
  },
}));

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };

function renderMenu() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          project: PROJECT,
          pathname: "/[project]",
          permissions: ["scenarios:view"],
        }}
      >
        <MainMenuSections showExpanded />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("given the project menu's traces destinations", () => {
  describe("when the menu renders", () => {
    /** @scenario The sidebar no longer offers the legacy Traces page */
    it("offers Trace Explorer as the only traces destination", () => {
      renderMenu();

      const tracesLinks = screen
        .getAllByRole("link")
        .filter((link) => /trace/i.test(link.textContent ?? ""));

      expect(tracesLinks.map((link) => link.textContent)).toEqual(["Trace Explorer"]);
    });
  });
});
