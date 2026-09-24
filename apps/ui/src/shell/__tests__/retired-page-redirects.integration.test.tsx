/**
 * Addresses that used to be served by a page whose whole body was a redirect.
 * @vitest-environment jsdom
 */

import { uiRoutePageKeys, type UiPageLoaderRegistry } from "@langwatch/ui-kernel/feature-install";
import { createUiRouteObjects } from "@langwatch/ui-kernel/route-objects";
import { act, render, waitFor } from "@testing-library/react";
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

describe("given the legacy Traces addresses", () => {
  describe("when a bookmark to the legacy Traces page is opened", () => {
    /** @scenario "The legacy Traces path lands on the Trace Explorer" */
    it("lands on the Trace Explorer", async () => {
      const router = open("/acme/messages");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/acme/traces");
      }, LAZY_CHROME);
    });
  });

  describe("when the legacy Traces link carries filters", () => {
    /** @scenario "A filtered legacy Traces link keeps what it was filtered by" */
    it("keeps every filter the link was saved with", async () => {
      const router = open("/acme/messages?startDate=2026-08-01&metadata.env=prod");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/acme/traces?startDate=2026-08-01&metadata.env=prod");
      }, LAZY_CHROME);
    });
  });

  describe("when a legacy trace deep link is opened", () => {
    /** @scenario "A legacy trace deep link opens the Trace Explorer" */
    it("opens the Trace Explorer drawer for that trace", async () => {
      const router = open("/acme/messages/trace-1");

      await waitFor(() => {
        expect(addressOf(router)).toBe(
          "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
        );
      }, LAZY_CHROME);
    });

    it("drops the legacy tab, which the Trace Explorer has no equivalent for", async () => {
      const router = open("/acme/messages/trace-1/spans");

      await waitFor(() => {
        expect(addressOf(router)).toBe(
          "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
        );
      }, LAZY_CHROME);
    });
  });

  describe("when a legacy span deep link is opened", () => {
    /** @scenario "A legacy span deep link opens the Trace Explorer with the span selected" */
    it("opens the drawer with the span selected", async () => {
      const router = open("/acme/messages/trace-1/spans/span-9");

      await waitFor(() => {
        expect(addressOf(router)).toBe(
          "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1&drawer.span=span-9",
        );
      }, LAZY_CHROME);
    });
  });

  describe("when the canonical trace short link is opened", () => {
    it("opens the Trace Explorer drawer for that trace", async () => {
      const router = open("/acme/traces/trace-1");

      await waitFor(() => {
        expect(addressOf(router)).toBe(
          "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
        );
      }, LAZY_CHROME);
    });

    it("percent-encodes a trace id that carries a reserved character", async () => {
      const router = open("/acme/traces/trace%2F1");

      await waitFor(() => {
        expect(addressOf(router)).toBe(
          "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace%2F1",
        );
      }, LAZY_CHROME);
    });

    /** @scenario "The short link forwards the timestamp to the drawer" */
    it("forwards the trace's start time to the drawer as the partition hint", async () => {
      const router = open("/acme/traces/trace-1?t=1714476000000");

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/acme/traces");
      }, LAZY_CHROME);
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get("drawer.open")).toBe("traceV2Details");
      expect(params.get("drawer.traceId")).toBe("trace-1");
      expect(params.get("drawer.t")).toBe("1714476000000");
      expect(params.has("t")).toBe(false);
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
      const router = open("/ops/queues");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops");
      }, LAZY_CHROME);
    });
  });

  describe("when a saved link to the scheduler page is opened", () => {
    it("lands on the schedules section of the event-sourcing workspace", async () => {
      const router = open("/ops/scheduler");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/event-sourcing/schedules");
      }, LAZY_CHROME);
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
      const router = open("/ops/backoffice");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/backoffice/users");
      }, LAZY_CHROME);
    });
  });
});

describe("given the retired admin addresses", () => {
  describe("when the bare admin address is opened", () => {
    it("lands on the backoffice, which forwards on to its default resource", async () => {
      const router = open("/admin");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/backoffice/users");
      }, LAZY_CHROME);
    });
  });

  describe("when a singular resource deep link is opened", () => {
    it("lands on the renamed resource, keeping the rest of the path", async () => {
      const router = open("/admin/user/u_1");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/backoffice/users/u_1");
      }, LAZY_CHROME);
    });

    it("matches the resource name whatever its case", async () => {
      const router = open("/admin/Subscription");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/backoffice/subscriptions");
      }, LAZY_CHROME);
    });

    it("keeps the query string and the hash", async () => {
      const router = open("/admin/organizations?page=2#row_7");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/backoffice/organizations?page=2#row_7");
      }, LAZY_CHROME);
    });
  });

  describe("when a resource the backoffice never took over is opened", () => {
    it("lands on the backoffice home rather than a fabricated address", async () => {
      const router = open("/admin/coupons/c_1");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops/backoffice/users");
      }, LAZY_CHROME);
    });
  });
});

describe("given the retired personal and evaluation addresses", () => {
  describe("when the devices inventory address is opened", () => {
    it("lands on the configure page with the devices tab selected", async () => {
      const router = open("/me/devices");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/me/configure?tab=devices");
      }, LAZY_CHROME);
    });
  });

  describe("when either new-evaluation address is opened", () => {
    it.each(["/acme/evaluations/new", "/acme/evaluations/new/choose"])(
      "%s opens the evaluator category selector on the online evaluations page",
      async (from) => {
        const router = open(from);

        await waitFor(() => {
          expect(addressOf(router)).toBe(
            "/acme/online-evaluations?drawer.open=evaluatorCategorySelector",
          );
        }, LAZY_CHROME);
      },
    );
  });
});

describe("given a reader who followed a retired address", () => {
  describe("when they press back", () => {
    it("returns to where they came from, not to the retired address", async () => {
      const router = open("/ops/queues");

      await waitFor(() => {
        expect(addressOf(router)).toBe("/ops");
      }, LAZY_CHROME);

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe(ORIGIN);
    });
  });
});
