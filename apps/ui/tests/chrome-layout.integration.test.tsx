/**
 * @vitest-environment jsdom
 *
 * The chrome layout route: which pages it draws the SHELL around, and where a
 * project pick lands.
 *
 * The shell — the top bar, the product sidebar and the content card — is drawn
 * over the pages THIS package serves and not over the ones `platform/app`
 * still serves, because those bring their own `DashboardLayout` and would
 * otherwise show two of everything. The rule is exact rather than heuristic —
 * a package screen cannot import `platform/app`, so it cannot have brought a
 * chrome — and both directions are asserted here.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { navigationApi } from "@langwatch/navigation-web/screens/landing";
import { WithStubNavigationHost } from "@langwatch/navigation-web/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createUiFeatureApiClient } from "../src/behavior/ui-feature-transport";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { projectSwitchHref } from "@langwatch/navigation-web/chrome";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";

vi.mock("../src/features/navigation", () => ({
  NavigationHostSection: ({ children }: { children: React.ReactNode }) => (
    <ShellTransport>
      <WithStubNavigationHost readings={SHELL_READINGS}>{children}</WithStubNavigationHost>
    </ShellTransport>
  ),
}));

/**
 * The Providers the shell's own reads run on.
 *
 * The shell asks four procedures for itself — the usage meter, the pending
 * annotation count, the personal-workspace features and the per-organization
 * product flags — so a suite that stubs the host still has to give those hooks
 * a client to be mounted under. Nothing answers: every query fails against no
 * server, which is exactly the frame this suite is about, since each of those
 * reads renders nothing until it has data.
 */
/**
 * A desktop viewport, because jsdom does not implement `matchMedia` at all.
 *
 * Without it every Chakra breakpoint query reports false, `base` wins, and the
 * shell draws its PHONE chrome — one compact bar and a full-screen menu, with
 * no sidebar column to find. The stub answers every `min-width` query yes,
 * which is what a wide window looks like.
 */
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

/**
 * Enough workspace for the shell to draw itself.
 *
 * The shell waits on the graph before it renders anything — a chrome drawn
 * against half a workspace is how a reader ends up looking at another
 * organization's sidebar — so a suite about the LAYOUT has to hand it a
 * resolved one. `organization:view` is what puts the Settings entry in the
 * column, which is the assertion below.
 */
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
  permissions: ["organization:view"],
  pathname: "/here",
};

/**
 * The trace drawer's global mount, stubbed.
 *
 * The chrome mounts it beside `CurrentDrawer` because the trace drawer cannot
 * be a registry entry (its URL sync has to outlive `?drawer.open=`). It reads
 * the trace family's host, which reads this application's capability ports —
 * and a suite about the LAYOUT mounts none of those. Its own wiring is asserted
 * in `trace-drawer-mount.integration.test.tsx`.
 */
vi.mock("../src/features/traces", () => ({
  UiTraceDrawerMount: () => null,
}));

// The other composed registry the layout route reads. Both of them import every
// feature in the package, which is the graph this suite is deliberately not
// about — the drawer half has its own suite in `chrome-drawer.integration`.
vi.mock("../src/features/installed-ui-drawers", () => ({
  installedUiDrawers: {},
}));

// The layout route is lazy, and it is the heaviest module in this suite — it
// pulls the design system's menu in through the product switcher. Resolving it
// once up front keeps each assertion from racing a first-time module load,
// which is what made the first test in the file fail while the rest passed.
beforeAll(async () => {
  await loaders["features/chrome/UiAppChrome"]();
});

// This package runs without vitest globals, so testing-library never registers
// its own auto-cleanup: without this the first render's header is still in the
// document when the second assertion looks for its absence.
afterEach(() => cleanup());

const loaders = {
  "features/chrome/UiAppChrome": () => import("../src/features/chrome/ui/sections/ui-app-chrome"),
  "pages/served-here": async () => ({ default: () => <div>packaged screen</div> }),
};

function renderAt(path: string) {
  const routes = createUiRouteObjects({
    table: [
      {
        page: "features/chrome/UiAppChrome",
        children: [{ path: "/here", page: "pages/served-here" }],
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

describe("given the chrome layout route", () => {
  describe("when the matched page is one this package serves", () => {
    it("draws the shell around it", async () => {
      renderAt("/here");

      await waitFor(() => {
        expect(screen.getByText("packaged screen")).toBeTruthy();
      });
      // The sidebar column and the content card are the two halves of the
      // shell the page renders inside; the entry proves the column is the real
      // one rather than an empty frame.
      expect(screen.getByTestId("product-sidebar")).toBeTruthy();
      expect(screen.getByTestId("shell-content-column")).toBeTruthy();
      expect(screen.getByLabelText("Settings")).toBeTruthy();
    });
  });
});

describe("given a project pick in the switcher", () => {
  describe("when the reader is on a project page", () => {
    /** @scenario Picking a different project preserves the current sub-route */
    it("lands on the same page in the picked project", () => {
      expect(
        projectSwitchHref({
          pathname: "/acme-app/traces",
          currentSlug: "acme-app",
          nextSlug: "acme-labs",
        }),
      ).toBe("/acme-labs/traces");
    });

    it("keeps the project home a project home", () => {
      expect(
        projectSwitchHref({ pathname: "/acme-app", currentSlug: "acme-app", nextSlug: "acme-labs" }),
      ).toBe("/acme-labs");
    });
  });

  describe("when the address carries no project segment", () => {
    it("lands on the picked project's home", () => {
      expect(
        projectSwitchHref({
          pathname: "/settings/secrets",
          currentSlug: "acme-app",
          nextSlug: "acme-labs",
        }),
      ).toBe("/acme-labs");
    });

    /** @scenario Picking a project from a non-project route falls back to project root */
    it("lands on the project home when no project is resolved at all", () => {
      expect(
        projectSwitchHref({ pathname: "/settings", currentSlug: void 0, nextSlug: "acme-labs" }),
      ).toBe("/acme-labs");
    });
  });

  describe("when a project slug is a prefix of the reader's own", () => {
    /** A plain startsWith would rewrite /acme-app-staging/traces as a sub-path. */
    it("matches on the segment boundary rather than the string", () => {
      expect(
        projectSwitchHref({
          pathname: "/acme-app-staging/traces",
          currentSlug: "acme-app",
          nextSlug: "acme-labs",
        }),
      ).toBe("/acme-labs");
    });
  });
});
