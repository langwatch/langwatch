/**
 * @vitest-environment jsdom
 *
 * The chrome layout route: which pages it draws a header around, and where a
 * project pick lands.
 *
 * The header is drawn over the pages THIS package serves and not over the ones
 * `platform/app` still serves, because those bring their own `DashboardLayout`
 * and would otherwise show two. The rule is exact rather than heuristic — a
 * package screen cannot import `platform/app`, so it cannot have brought a
 * header — and both directions are asserted here.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectSwitchHref } from "../src/features/chrome/ui/blocks/ui-project-switcher";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";

vi.mock("../src/features/navigation", () => ({
  NavigationHostSection: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../src/features/installed-ui-page-keys", () => ({
  isUiInstalledPage: (key: string) => key === "pages/served-here",
}));

// This package runs without vitest globals, so testing-library never registers
// its own auto-cleanup: without this the first render's header is still in the
// document when the second assertion looks for its absence.
afterEach(() => cleanup());

const loaders = {
  "features/chrome/UiAppChrome": () => import("../src/features/chrome/ui/sections/ui-app-chrome"),
  "pages/served-here": async () => ({ default: () => <div>packaged screen</div> }),
  "pages/served-by-platform": async () => ({ default: () => <div>legacy screen</div> }),
};

function renderAt(path: string) {
  const routes = createUiRouteObjects({
    table: [
      {
        page: "features/chrome/UiAppChrome",
        children: [
          { path: "/here", page: "pages/served-here" },
          { path: "/legacy", page: "pages/served-by-platform" },
        ],
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
    it("draws the header around it", async () => {
      renderAt("/here");

      await waitFor(() => {
        expect(screen.getByText("packaged screen")).toBeTruthy();
      });
      expect(screen.getByLabelText("LangWatch home")).toBeTruthy();
      expect(screen.getByLabelText("Settings")).toBeTruthy();
    });
  });

  describe("when the matched page is one platform/app still serves", () => {
    it("renders the page bare, so its own DashboardLayout is the only header", async () => {
      renderAt("/legacy");

      await waitFor(() => {
        expect(screen.getByText("legacy screen")).toBeTruthy();
      });
      expect(screen.queryByLabelText("LangWatch home")).toBeNull();
    });
  });
});

describe("given a project pick in the switcher", () => {
  describe("when the reader is on a project page", () => {
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
