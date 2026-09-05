/**
 * The gap eighteen family manifests recorded, asserted closed.
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/ui-drawer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { navigationApi } from "@langwatch/navigation-web/screens/navigation";
import { WithStubNavigationHost } from "@langwatch/navigation-web/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createUiFeatureApiClient } from "../src/behavior/ui-feature-transport";
import { afterEach, describe, expect, it, vi } from "vitest";
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
 */
vi.mock("../src/features/traces", () => ({
  UiTraceDrawerMount: () => null,
}));

function QueueEditorDrawer({ queueId }: { queueId?: string }) {
  const { closeDrawer } = useDrawer();
  return (
    <div>
      <p>{`editing queue ${queueId ?? "none"}`}</p>
      <button type="button" onClick={closeDrawer}>
        Close drawer
      </button>
    </div>
  );
}

vi.mock("../src/features/installed-ui-features", () => ({
  installedUiDrawers: { queueEditor: QueueEditorDrawer },
}));

// This package runs without vitest globals, so testing-library never registers
// its own auto-cleanup: without this one render's drawer is still in the
// document when the next assertion looks for it.
afterEach(() => cleanup());

function CurrentAddress() {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

const loaders = {
  "features/chrome/UiAppChrome": () => import("../src/features/chrome/ui/sections/ui-app-chrome"),
  "pages/served-here": async () => ({
    default: () => (
      <div>
        <span>packaged screen</span>
        <CurrentAddress />
      </div>
    ),
  }),
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

describe("given an address that names an installed drawer", () => {
  describe("when the chrome layout route renders a page below it", () => {
    it("opens the drawer with the parameters the address carries", async () => {
      renderAt("/here?drawer.open=queueEditor&drawer.queueId=q-42");

      await waitFor(() => {
        expect(screen.getByText("packaged screen")).toBeTruthy();
      });
      expect(await screen.findByText("editing queue q-42")).toBeTruthy();
    });
  });

  describe("when the reader closes the drawer", () => {
    it("takes it out of the address and leaves the page's own parameters alone", async () => {
      renderAt("/here?tab=queues&drawer.open=queueEditor&drawer.queueId=q-42");
      const close = await screen.findByRole("button", { name: "Close drawer" });

      await act(async () => {
        fireEvent.click(close);
      });

      await waitFor(() => {
        expect(screen.getByTestId("address").textContent).toBe("/here?tab=queues");
      });
      expect(screen.queryByText("editing queue q-42")).toBeNull();
    });
  });
});

describe("given an address that names no drawer", () => {
  describe("when the chrome layout route renders", () => {
    it("mounts none", async () => {
      renderAt("/here");

      await waitFor(() => {
        expect(screen.getByText("packaged screen")).toBeTruthy();
      });
      expect(screen.queryByText(/^editing queue /)).toBeNull();
    });
  });
});
