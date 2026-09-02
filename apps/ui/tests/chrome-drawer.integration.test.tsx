/**
 * @vitest-environment jsdom
 *
 * The gap eighteen family manifests recorded, asserted closed.
 *
 * Every family that moved a screen out of `platform/app` wrote the same line:
 * the screen asks its host to open a drawer, the host writes
 * `?drawer.open=<name>` into the address, and NOTHING OPENS — because the mount
 * lived in `platform/app`'s `DashboardLayout` and the registry behind it named
 * forty-five modules of that application. This drives the whole path the way a
 * reader does: an address that names a drawer, through the chrome LAYOUT ROUTE,
 * onto a page below it, and the drawer is on screen.
 *
 * The registry is stubbed and the route table is not. What is under test is the
 * wiring — that the layout route mounts the host, that the host reads the
 * address, that closing writes the address back — and a stub registry is what
 * keeps that from turning into a test of one family's tRPC provider. The real
 * registry's own invariants are asserted in `installed-ui-drawers.unit.test.ts`.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/ui-drawer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";

vi.mock("../src/features/navigation", () => ({
  NavigationHostSection: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../src/features/installed-ui-page-keys", () => ({
  isUiInstalledPage: (key: string) => key === "pages/served-here",
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

vi.mock("../src/features/installed-ui-drawers", () => ({
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
  "features/chrome/UiAppChrome": () =>
    import("../src/features/chrome/ui/sections/ui-app-chrome"),
  "pages/served-here": async () => ({
    default: () => (
      <div>
        <span>packaged screen</span>
        <CurrentAddress />
      </div>
    ),
  }),
  "pages/served-by-platform": async () => ({
    default: () => <div>legacy screen</div>,
  }),
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

  describe("when the page below is one platform/app still serves", () => {
    /**
     * A drawer is addressed by the query string and renders through a portal,
     * so a reader who follows a `?drawer.open=` link onto a legacy page is
     * asking for the same drawer. The header is the conditional half; the
     * drawer mount is not.
     */
    it("opens the drawer over it anyway", async () => {
      renderAt("/legacy?drawer.open=queueEditor&drawer.queueId=q-7");

      await waitFor(() => {
        expect(screen.getByText("legacy screen")).toBeTruthy();
      });
      expect(await screen.findByText("editing queue q-7")).toBeTruthy();
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
