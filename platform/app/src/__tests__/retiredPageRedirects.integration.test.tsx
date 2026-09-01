/**
 * @vitest-environment jsdom
 *
 * Addresses that used to be served by a page whose whole body was a redirect.
 * The forwarding is a row in the packaged route table now, so what is asserted
 * here is the address the reader ends on when the REAL table is mounted in a
 * router: every page key is stubbed, every redirect descriptor is the one the
 * application ships, and the match ranking is React Router's own. A dropped
 * row, a retargeted row or a destination the table no longer serves shows up
 * as a reader landing somewhere else.
 *
 * These cases were written against the redirect page components
 * (`pages/[project]/messages/**`, `pages/[project]/traces/[trace]`,
 * `pages/ops/queues`), which are deleted. The scenarios they bind are
 * unchanged; only what serves them moved.
 *
 * Specs: specs/traces-v2/default-drawer-routing.feature
 *        specs/ops/ops-dashboard-density.feature
 */

import {
  createUiRouteObjects,
  uiRoutePageKeys,
  uiRouteTable,
  type UiPageLoaderRegistry,
} from "@langwatch/ui";
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

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

const realRoutes = createUiRouteObjects({ table: uiRouteTable, loaders: stubbedPages });

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

/**
 * Asserts the whole address — path, query and hash — the reader ends on.
 *
 * Waiting for the final address rather than for "anything but the start" is
 * what makes a chained forward (`/admin` -> `/ops/backoffice` -> its default
 * resource) assert on where the reader actually stops.
 */
async function expectLands({ from, at }: { from: string; at: string }) {
  const router = open(from);

  await waitFor(() => {
    const { pathname, search, hash } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe(at);
  });
  return router;
}

describe("given the legacy Traces addresses", () => {
  describe("when a bookmark to the legacy Traces page is opened", () => {
    /** @scenario "The legacy Traces path lands on the Trace Explorer" */
    it("lands on the Trace Explorer", async () => {
      await expectLands({ from: "/acme/messages", at: "/acme/traces" });
    });
  });

  describe("when the legacy Traces link carries filters", () => {
    /** @scenario "A filtered legacy Traces link keeps what it was filtered by" */
    it("keeps every filter the link was saved with", async () => {
      await expectLands({
        from: "/acme/messages?startDate=2026-08-01&metadata.env=prod",
        at: "/acme/traces?startDate=2026-08-01&metadata.env=prod",
      });
    });
  });

  describe("when a legacy trace deep link is opened", () => {
    /** @scenario "A legacy trace deep link opens the Trace Explorer" */
    it("opens the Trace Explorer drawer for that trace", async () => {
      await expectLands({
        from: "/acme/messages/trace-1",
        at: "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
      });
    });

    it("drops the legacy tab, which the Trace Explorer has no equivalent for", async () => {
      await expectLands({
        from: "/acme/messages/trace-1/spans",
        at: "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
      });
    });
  });

  describe("when a legacy span deep link is opened", () => {
    /** @scenario "A legacy span deep link opens the Trace Explorer with the span selected" */
    it("opens the drawer with the span selected", async () => {
      await expectLands({
        from: "/acme/messages/trace-1/spans/span-9",
        at: "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1&drawer.span=span-9",
      });
    });
  });

  describe("when the canonical trace short link is opened", () => {
    it("opens the Trace Explorer drawer for that trace", async () => {
      await expectLands({
        from: "/acme/traces/trace-1",
        at: "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
      });
    });

    it("percent-encodes a trace id that carries a reserved character", async () => {
      await expectLands({
        from: "/acme/traces/trace%2F1",
        at: "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace%2F1",
      });
    });
  });

  describe("when the link is missing the ids it needs", () => {
    /**
     * The redirect pages carried a `/404` branch for a missing project or
     * trace id. Under this router that branch was already unreachable: a route
     * only matches once every required segment is bound. What answers the
     * scenario is the table itself — a link with no project segment matches
     * nothing but the catch-all, which is the not-found page.
     *
     * @scenario "A malformed trace link lands on not-found instead of a blank page"
     */
    it("lands on the not-found page", async () => {
      const router = open("/traces/trace-1");

      await waitFor(() => {
        expect(document.body.textContent).toContain("pages/not-found");
      });
      expect(router.state.matches.at(-1)?.route.path).toBe("*");
      expect(router.state.location.pathname).toBe("/traces/trace-1");
    });
  });
});

describe("given the retired ops addresses", () => {
  describe("when an operator follows a saved link to the queues page", () => {
    /** @scenario A retired queues link lands on the dashboard */
    it("sends them to the ops dashboard", async () => {
      await expectLands({ from: "/ops/queues", at: "/ops" });
    });
  });

  describe("when a saved link to the scheduler page is opened", () => {
    it("lands on the schedules section of the event-sourcing workspace", async () => {
      await expectLands({ from: "/ops/scheduler", at: "/ops/event-sourcing/schedules" });
    });
  });

  describe("when a saved link to the projections page is opened", () => {
    it("leaves the per-run progress page alone", async () => {
      const router = open("/ops/projections/run_1");

      await waitFor(() => {
        expect(document.body.textContent).toContain("pages/ops/projections/[runId]");
      });
      expect(router.state.location.pathname).toBe("/ops/projections/run_1");
    });
  });

  describe("when the backoffice entry is opened", () => {
    it("lands on the default resource", async () => {
      await expectLands({ from: "/ops/backoffice", at: "/ops/backoffice/users" });
    });
  });
});

describe("given the retired admin addresses", () => {
  describe("when the bare admin address is opened", () => {
    it("lands on the backoffice, which forwards on to its default resource", async () => {
      await expectLands({ from: "/admin", at: "/ops/backoffice/users" });
    });
  });

  describe("when a singular resource deep link is opened", () => {
    it("lands on the renamed resource, keeping the rest of the path", async () => {
      await expectLands({ from: "/admin/user/u_1", at: "/ops/backoffice/users/u_1" });
    });

    it("matches the resource name whatever its case", async () => {
      await expectLands({ from: "/admin/Subscription", at: "/ops/backoffice/subscriptions" });
    });

    it("keeps the query string and the hash", async () => {
      await expectLands({
        from: "/admin/organizations?page=2#row_7",
        at: "/ops/backoffice/organizations?page=2#row_7",
      });
    });
  });

  describe("when a resource the backoffice never took over is opened", () => {
    it("lands on the backoffice home rather than a fabricated address", async () => {
      await expectLands({ from: "/admin/coupons/c_1", at: "/ops/backoffice/users" });
    });
  });
});

describe("given the retired personal and evaluation addresses", () => {
  describe("when the devices inventory address is opened", () => {
    it("lands on the configure page with the devices tab selected", async () => {
      await expectLands({ from: "/me/devices", at: "/me/configure?tab=devices" });
    });
  });

  describe("when either new-evaluation address is opened", () => {
    it.each(["/acme/evaluations/new", "/acme/evaluations/new/choose"])(
      "%s opens the evaluator category selector on the online evaluations page",
      async (from) => {
        await expectLands({
          from,
          at: "/acme/online-evaluations?drawer.open=evaluatorCategorySelector",
        });
      },
    );
  });
});

describe("given a reader who followed a retired address", () => {
  describe("when they press back", () => {
    it("returns to where they came from, not to the retired address", async () => {
      const router = await expectLands({ from: "/ops/queues", at: "/ops" });

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe(ORIGIN);
    });
  });
});
