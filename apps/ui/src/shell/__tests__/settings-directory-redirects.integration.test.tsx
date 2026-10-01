/**
 * The settings pages that became the Directory's tabs and the Roles page's
 * assignments tab: each old address forwards onto the tab it became.
 * @vitest-environment jsdom
 */

import { uiRoutePageKeys, type UiPageLoaderRegistry } from "@langwatch/ui-kernel/feature-install";
import { createUiRouteObjects } from "@langwatch/ui-kernel/route-objects";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { uiRouteTable } from "../ui-route-table";

/**
 * Every page the table names, stubbed by its key. A layout route has to render
 * its `Outlet` or the redirect nested under it never mounts, and a leaf that
 * renders one is unaffected, so every stub renders both.
 */
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

/** The shell layouts, stubbed the same way — they carry no page key of their own. */
const stubbedShellLayouts = {
  auth: async () => ({ default: () => <Outlet /> }),
  chrome: async () => ({ default: () => <Outlet /> }),
  "full-screen": async () => ({ default: () => <Outlet /> }),
};

const realRoutes = createUiRouteObjects({
  table: uiRouteTable,
  loaders: stubbedPages,
  shellLayouts: stubbedShellLayouts,
});

/** Somewhere to come back to, so a replaced history entry is observable. */
const ORIGIN = "/ops/dejaview";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

/** Opens `address` on the real table, with `ORIGIN` behind it in the history. */
function open(address: string) {
  const router = createMemoryRouter(realRoutes, {
    initialEntries: [ORIGIN, address],
    initialIndex: 1,
  });
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return router;
}

/** The whole address — path, query and hash — the reader is on. */
function addressOf(router: ReturnType<typeof open>) {
  const { pathname, search, hash } = router.state.location;
  return `${pathname}${search}${hash}`;
}

// The chrome layout is lazy, and resolving its chunk on the FIRST case in this
// file costs more than waitFor's 1s default, which read as a route-table bug.
const LAZY_CHROME = { timeout: 5000 };

describe("given the retired people and access addresses", () => {
  describe("when the old members address is opened", () => {
    /** @scenario "The old members address forwards onto the tab it became" */
    it("lands on the directory's people tab", async () => {
      const router = open("/settings/members");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/directory");
      }, LAZY_CHROME);
    });

    it("carries the tab it named across as the people cut", async () => {
      const router = open("/settings/members?tab=invitations");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/directory?people=invitations");
      }, LAZY_CHROME);
    });
  });

  describe("when the old teams address is opened", () => {
    /** @scenario "The old teams address forwards onto the tab it became" */
    it("lands on the directory's teams and projects tab", async () => {
      const router = open("/settings/teams");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/directory?tab=teams");
      }, LAZY_CHROME);
    });

    it("leaves a team's own page alone", async () => {
      const router = open("/settings/teams/platform");

      await waitFor(() => {
        expect(document.body.textContent).toContain("pages/settings/teams/[team]");
      }, LAZY_CHROME);
      expect(router.state.location.pathname).toBe("/settings/teams/platform");
    });
  });

  describe("when the old groups address is opened", () => {
    /** @scenario "The old groups address forwards onto the tab it became" */
    it("lands on the directory's groups tab", async () => {
      const router = open("/settings/groups");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/directory?tab=groups");
      }, LAZY_CHROME);
    });
  });

  describe("when the old directory sync address is opened", () => {
    /** @scenario "The old directory sync address forwards onto the page it became" */
    it("lands on the directory", async () => {
      const router = open("/settings/scim");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/directory");
      }, LAZY_CHROME);
    });
  });

  describe("when the old access address is opened", () => {
    /** @scenario "The old access address forwards onto the page it became" */
    it("lands on the directory", async () => {
      const router = open("/settings/access");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/directory");
      }, LAZY_CHROME);
    });
  });

  describe("when the old role bindings address is opened", () => {
    /** @scenario "The old role bindings address forwards onto the tab it became" */
    it("lands on the roles page's assignments tab", async () => {
      const router = open("/settings/role-bindings");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/settings/roles?tab=assignments");
      }, LAZY_CHROME);
    });
  });

  describe("when the directory itself is opened", () => {
    it("draws the directory page", async () => {
      open("/settings/directory?tab=groups");

      await waitFor(() => {
        expect(document.body.textContent).toContain("pages/settings/directory");
      }, LAZY_CHROME);
    });
  });
});
