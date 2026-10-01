/**
 * @vitest-environment jsdom
 * @see specs/traces-v2/default-drawer-routing.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NavigationProject } from "../../../model/navigation-host.ts";
import { WithStubNavigationHost } from "../../../testing.tsx";
import { MainMenuSections } from "../main-menu.tsx";

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
  },
}));

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };

function renderMenu() {
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        project: PROJECT,
        pathname: "/[project]",
        permissions: ["scenarios:view"],
      }}
    >
      <MainMenuSections showExpanded />
    </WithStubNavigationHost>,
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
