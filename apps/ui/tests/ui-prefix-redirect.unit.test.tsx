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
