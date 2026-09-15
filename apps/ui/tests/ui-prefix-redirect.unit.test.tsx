import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, type RouteObject, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { UiPrefixRedirect } from "../src/ui/elements/ui-prefix-redirect";

function renderAt(initialEntry: string, element: ReactElement) {
  const routes: RouteObject[] = [
    { path: "/old/*", element },
    { path: "/old", element },
    { path: "/new/*", element: <div>new</div> },
    { path: "/new", element: <div>new</div> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

describe("given a prefix that moved", () => {
  describe("when a deep link to the retired address is loaded", () => {
    it("forwards the sub-path, query string and hash to the new prefix", () => {
      const { router, view } = renderAt(
        "/old/thing?keep=1&other=2#section",
        <UiPrefixRedirect from="/old" to="/new" />,
      );
      dispose = () => {
        view.unmount();
        router.dispose();
      };

      expect(router.state.location.pathname).toBe("/new/thing");
      expect(router.state.location.search).toBe("?keep=1&other=2");
      expect(router.state.location.hash).toBe("#section");
    });
  });

  describe("when the destination has to pin a query param", () => {
    it("overrides the pinned key and keeps every other one", () => {
      const { router, view } = renderAt(
        "/old?tab=stale&keep=1",
        <UiPrefixRedirect from="/old" to="/new" pinParams={{ tab: "sources" }} />,
      );
      dispose = () => {
        view.unmount();
        router.dispose();
      };

      expect(router.state.location.pathname).toBe("/new");
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get("tab")).toBe("sources");
      expect(params.get("keep")).toBe("1");
    });
  });
});

describe("given a retired address inside a parameterised family", () => {
  function renderParameterised(initialEntry: string) {
    const routes: RouteObject[] = [
      {
        path: "/:project/messages/:trace",
        element: (
          <UiPrefixRedirect
            from="/:project/messages/:trace"
            to="/:project/traces"
            pinParams={{ "drawer.open": "traceV2Details", "drawer.traceId": ":trace" }}
          />
        ),
      },
      { path: "/:project/traces", element: <div>traces</div> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
    const view = render(<RouterProvider router={router} />);
    dispose = () => {
      view.unmount();
      router.dispose();
    };
    return router;
  }

  describe("when the deep link is loaded", () => {
    it("fills the destination and the pinned params from the matched route", () => {
      const router = renderParameterised("/acme/messages/trace-1");

      expect(router.state.location.pathname).toBe("/acme/traces");
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get("drawer.open")).toBe("traceV2Details");
      expect(params.get("drawer.traceId")).toBe("trace-1");
    });

    it("encodes a param value that carries a reserved character", () => {
      const router = renderParameterised("/acme/messages/trace%2F1");

      expect(router.state.location.search).toContain("drawer.traceId=trace%2F1");
    });
  });
});

describe("given retired resource names that were renamed on the way over", () => {
  const mapSegment = { user: "users", subscription: "subscriptions" };

  function renderMapped(initialEntry: string) {
    const routes: RouteObject[] = [
      {
        path: "/admin/*",
        element: <UiPrefixRedirect from="/admin" to="/ops/backoffice" mapSegment={mapSegment} />,
      },
      { path: "/ops/backoffice/*", element: <div>backoffice</div> },
      { path: "/ops/backoffice", element: <div>backoffice</div> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
    const view = render(<RouterProvider router={router} />);
    dispose = () => {
      view.unmount();
      router.dispose();
    };
    return router;
  }

  describe("when a renamed resource is deep-linked", () => {
    it("renames the first segment and keeps everything under it", () => {
      expect(renderMapped("/admin/user/u_1").state.location.pathname).toBe(
        "/ops/backoffice/users/u_1",
      );
    });

    it("matches the resource name whatever its case", () => {
      expect(renderMapped("/admin/Subscription").state.location.pathname).toBe(
        "/ops/backoffice/subscriptions",
      );
    });
  });

  describe("when the address names no resource the table knows", () => {
    it("lands on the destination itself rather than a fabricated address", () => {
      expect(renderMapped("/admin/coupons/c_1").state.location.pathname).toBe("/ops/backoffice");
    });

    it("lands on the destination for the bare retired address", () => {
      expect(renderMapped("/admin").state.location.pathname).toBe("/ops/backoffice");
    });
  });
});
