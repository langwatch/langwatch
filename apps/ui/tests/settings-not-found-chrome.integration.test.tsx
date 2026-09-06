/**
 * An address under /settings that names no page: it keeps the settings shell.
 *
 * `platform/app` framed its 404 in `DashboardLayout`, so a mistyped settings address still
 * carried the sidebar and the top bar and the reader could get back. Mounted on the table's own
 * top-level catch-all instead, the same address rendered a bare full-viewport 404 with no menu.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { navigationApi } from "@langwatch/navigation-web/screens/navigation";
import { WithStubNavigationHost } from "@langwatch/navigation-web/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createUiFeatureApiClient } from "../src/behavior/ui-feature-transport";
import {
  uiRouteDescriptors,
  uiRouteTable,
  type UiRouteDescriptor,
} from "../src/model/ui-route-table";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";

vi.mock("../src/features/navigation", () => ({
  NavigationHostSection: ({ children }: { children: React.ReactNode }) => (
    <ShellTransport>
      <WithStubNavigationHost readings={SHELL_READINGS}>{children}</WithStubNavigationHost>
    </ShellTransport>
  ),
}));

vi.mock("../src/features/traces", () => ({ UiTraceDrawerMount: () => null }));
vi.mock("../src/features/installed-ui-features", () => ({ installedUiDrawers: {} }));

function useDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => void 0,
    removeEventListener: () => void 0,
    addListener: () => void 0,
    removeListener: () => void 0,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function ShellTransport({ children }: { children: React.ReactNode }) {
  useDesktopViewport();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [client] = useState(() => createUiFeatureApiClient());
  return (
    <QueryClientProvider client={queryClient}>
      <navigationApi.Provider client={client} queryClient={queryClient}>
        {children}
      </navigationApi.Provider>
    </QueryClientProvider>
  );
}

const TEAM = {
  id: "team-1",
  name: "Core",
  members: [{ userId: "user-1" }],
  projects: [{ id: "project-1", name: "Acme App", slug: "acme-app" }],
};
const ORGANIZATION = { id: "org-1", name: "Acme", teams: [TEAM] };
const SHELL_READINGS = {
  organizations: [ORGANIZATION],
  organization: ORGANIZATION,
  team: TEAM,
  project: TEAM.projects[0],
  currentUser: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
  permissions: ["organization:view", "organization:manage"],
  pathname: "/settings/does-not-exist",
};

const loaders = {
  "features/chrome/UiAppChrome": () => import("../src/features/chrome/ui/sections/ui-app-chrome"),
  "pages/settings/not-found": async () => ({ default: () => <div>no such settings page</div> }),
};

beforeAll(async () => {
  await loaders["features/chrome/UiAppChrome"]();
});

afterEach(() => cleanup());

/** The real table's own nesting for the address under test. */
function settingsNotFoundDescriptor(): UiRouteDescriptor | undefined {
  return uiRouteDescriptors(uiRouteTable).find(
    (descriptor) => "page" in descriptor && descriptor.path === "/settings/*",
  );
}

/** Whether the branch of the real table that holds it is drawn inside the chrome route. */
function isInsideChrome(path: string): boolean {
  const walk = (descriptors: readonly UiRouteDescriptor[], underChrome: boolean): boolean =>
    descriptors.some((descriptor) => {
      if ("redirect" in descriptor) return false;
      const inside = underChrome || descriptor.page === "features/chrome/UiAppChrome";
      if (descriptor.path === path) return inside;
      return walk(descriptor.children ?? [], inside);
    });
  return walk(uiRouteTable, false);
}

function renderAt(path: string) {
  const routes = createUiRouteObjects({
    table: [
      {
        page: "features/chrome/UiAppChrome",
        children: [{ path: "/settings/*", page: "pages/settings/not-found" }],
      },
    ],
    loaders,
  });
  return render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </ChakraProvider>,
  );
}

describe("given an address under /settings that names no page", () => {
  describe("when the route table is read", () => {
    it("mounts the settings not-found route inside the application chrome", () => {
      expect(settingsNotFoundDescriptor()).toBeTruthy();
      expect(isInsideChrome("/settings/*")).toBe(true);
    });
  });

  describe("when the address is opened", () => {
    /** @scenario An address under Settings that names no page keeps it */
    it("keeps the settings navigation and the shell around the 404", async () => {
      renderAt("/settings/does-not-exist");

      await waitFor(() => {
        expect(screen.getByText("no such settings page")).toBeTruthy();
      });

      expect(screen.getByTestId("product-sidebar")).toBeTruthy();
      expect(screen.getByTestId("shell-content-column")).toBeTruthy();
      // The settings MENU rather than the product menu: the sidebar picks its
      // surface off the address, and this address is a settings address.
      expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    });
  });
});
