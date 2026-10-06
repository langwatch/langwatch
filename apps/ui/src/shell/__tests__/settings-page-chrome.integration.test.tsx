/**
 * What a reader opening a settings address sees drawn around the page.
 * Spec: specs/settings/settings-page-chrome.feature
 * @vitest-environment jsdom
 */

import { uiRoutePageKeys, type UiPageLoaderRegistry } from "@langwatch/browser/feature-install";
import { installedModuleScreens } from "@langwatch/browser/module-screens";
import { createUiRouteObjects } from "@langwatch/browser/route-objects";
import { navigationWeb } from "@langwatch/navigation-browser/declaration";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { browserModules } from "../../browser-modules.generated.ts";
import { uiRouteTable } from "../ui-route-table";

const { resolveShellRoute } = await navigationWeb.installation.capabilities.chrome.load();

const stubbedPages: UiPageLoaderRegistry = Object.fromEntries(
  uiRoutePageKeys(uiRouteTable).map((key) => [
    key,
    async () => ({
      default: () => (
        <>
          <span>{key}</span>
          <Outlet />
        </>
      ),
    }),
  ]),
);

/** The chrome, drawn as a marker the page can be found inside. */
function Chrome() {
  return (
    <div data-testid="chrome">
      <Outlet />
    </div>
  );
}

const routes = createUiRouteObjects({
  table: uiRouteTable,
  loaders: stubbedPages,
  shellLayouts: {
    auth: async () => ({ default: () => <Outlet /> }),
    chrome: async () => ({ default: Chrome }),
    "full-screen": async () => ({ default: () => <Outlet /> }),
  },
});

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function open(address: string) {
  const router = createMemoryRouter(routes, { initialEntries: [address] });
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return router;
}

const LAZY_CHROME = { timeout: 5000 };
const isSettingsDetour = (pathname: string) =>
  resolveShellRoute({
    pathname,
    isPersonalScope: false,
    isOrgScope: false,
    isOnOwnPersonalProject: false,
    organizationRole: "ADMIN",
  }).isSettingsRoute;

describe("given a reader who can view the triggers of this project", () => {
  describe("when the email suppressions page is opened", () => {
    /** @scenario The email suppressions page keeps it */
    it("draws the page inside the chrome that carries the settings menu", async () => {
      const address = "/settings/email-suppressions";
      open(address);

      const chrome = await screen.findByTestId("chrome", {}, LAZY_CHROME);
      await waitFor(() => {
        expect(within(chrome).getByText("pages/settings/email-suppressions")).toBeDefined();
      }, LAZY_CHROME);
      expect(
        installedModuleScreens(browserModules).loaders["pages/settings/email-suppressions"],
      ).toBeDefined();
      expect(isSettingsDetour(address)).toBe(true);
    });
  });
});

describe("given an address under Settings that names no page", () => {
  describe("when it is opened", () => {
    /** @scenario An address under Settings that names no page keeps it */
    it("draws the not-found page inside the chrome, which is still the settings detour", async () => {
      const address = "/settings/no-such-page";
      open(address);

      const chrome = await screen.findByTestId("chrome", {}, LAZY_CHROME);
      await waitFor(() => {
        expect(within(chrome).getByText("pages/settings/not-found")).toBeDefined();
      }, LAZY_CHROME);
      expect(isSettingsDetour(address)).toBe(true);
    });
  });
});
