/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { createUiQueryClient } from "@langwatch/browser-host/query-client";
import { answeringUiTransport } from "@langwatch/browser-host/testing-transport";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { navigationApi } from "../../../behavior/navigation-api.ts";
import type { NavigationProject } from "../../../model/navigation-host.ts";
import { WithStubNavigationHost } from "../../../testing.tsx";
import { MainMenuSections } from "../main-menu.tsx";

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };

const transport = answeringUiTransport(({ path }) =>
  path === "annotation.getPendingItemsCount"
    ? Promise.resolve({ count: 0 })
    : Promise.reject(new Error(`No test answer for ${path}`)),
);

function renderMenu({
  dashboardsEnabled,
  permissions = ["analytics:view"],
}: {
  dashboardsEnabled: boolean;
  permissions?: readonly string[];
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <navigationApi.Provider client={transport} queryClient={createUiQueryClient()}>
        <WithStubNavigationHost
          readings={{
            project: PROJECT,
            pathname: "/[project]",
            permissions,
            flags: { release_dashboards: { enabled: dashboardsEnabled, isLoading: false } },
          }}
        >
          <MainMenuSections showExpanded />
        </WithStubNavigationHost>
      </navigationApi.Provider>
    </ChakraProvider>,
  );
}

const dashboardsLink = () => screen.queryByRole("link", { name: "Dashboards" });

describe("the Dashboards entry in the main menu", () => {
  describe("given the dashboards flag is off for the project", () => {
    /** @scenario "AC1 Flag off hides the area" */
    it("shows no Dashboards entry", () => {
      renderMenu({ dashboardsEnabled: false });

      expect(dashboardsLink()).toBeNull();
      expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
    });
  });

  describe("given the dashboards flag is on for the project", () => {
    it("links the Dashboards area of the project", () => {
      renderMenu({ dashboardsEnabled: true });

      expect(dashboardsLink()).toHaveAttribute("href", "/demo/dashboards");
    });

    describe("when the member lacks analytics:view", () => {
      it("shows no Dashboards entry", () => {
        renderMenu({ dashboardsEnabled: true, permissions: [] });

        expect(dashboardsLink()).toBeNull();
      });
    });
  });
});
