/**
 * @vitest-environment jsdom
 * The drawer navigator's writes: they survive a sibling navigator unmounting, a
 * blocked navigation leaves no phantom drawer, a write after an await builds on the landed one,
 * in-drawer Back leaves history where the browser Back expects it, and a write keeps the fragment.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createBrowserRouter,
  createMemoryRouter,
  MemoryRouter,
  type NavigateFunction,
  RouterProvider,
  useBlocker,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { drawerRouterRef, useDrawerRouter } from "../drawer-router.ts";
import { getTopDrawer, navigateToDrawer, updateDrawerParams, useDrawer } from "../use-drawer.ts";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  drawerRouterRef.current = undefined;
});

function Navigator() {
  useDrawerRouter();
  return null;
}

function Probe() {
  const { search, hash } = useLocation();
  return <div data-testid="address">{`${search}${hash}`}</div>;
}

describe("given two mounted drawer navigators", () => {
  describe("when the one registered last unmounts", () => {
    it("still writes a drawer param through the navigator that remains", async () => {
      const tree = (withSecond: boolean) => (
        <MemoryRouter
          initialEntries={["/acme/traces?drawer.open=traceV2Details&drawer.traceId=t1"]}
        >
          <Navigator />
          {withSecond && <Navigator />}
          <Probe />
        </MemoryRouter>
      );
      const view = render(tree(true));
      view.rerender(tree(false));

      await act(async () => {
        updateDrawerParams({ spanId: "s1" });
      });

      expect(screen.getByTestId("address")).toHaveTextContent("drawer.spanId=s1");
    });
  });
});

describe("given a navigation that a blocker refuses", () => {
  describe("when a drawer is opened from module-level code", () => {
    it("leaves no drawer open", async () => {
      function Blocked() {
        useBlocker(true);
        useDrawerRouter();
        return null;
      }
      const router = createMemoryRouter([{ path: "/acme/traces", element: <Blocked /> }], {
        initialEntries: ["/acme/traces"],
      });
      render(<RouterProvider router={router} />);

      await act(async () => {
        navigateToDrawer("traceV2Details");
      });

      await waitFor(() => expect(getTopDrawer()).toBeUndefined());
      expect(router.state.location.search).toBe("");
    });
  });
});

describe("given a write whose navigation landed before React re-rendered", () => {
  describe("when a second write follows an await, as an onSuccess opening a drawer does", () => {
    it("builds on the first write's address", async () => {
      window.history.replaceState(null, "", "/acme/traces");
      const router = createBrowserRouter([
        {
          path: "/acme/traces",
          element: (
            <>
              <Navigator />
              <Probe />
            </>
          ),
        },
      ]);
      render(<RouterProvider router={router} />);

      await act(async () => {
        navigateToDrawer("traceV2Details");
        await new Promise((resolve) => setTimeout(resolve, 0));
        updateDrawerParams({ spanId: "s1" });
      });

      expect(screen.getByTestId("address")).toHaveTextContent("drawer.open=traceV2Details");
      expect(screen.getByTestId("address")).toHaveTextContent("drawer.spanId=s1");
      router.dispose();
    });
  });
});

describe("given a drawer opened over another", () => {
  describe("when the reader goes back inside the drawer, then presses the browser Back", () => {
    it("returns to the drawer they left rather than repeating the address", async () => {
      let drawers: ReturnType<typeof useDrawer> | undefined;
      let navigate: NavigateFunction | undefined;
      function Host() {
        drawers = useDrawer();
        navigate = useNavigate();
        return <Probe />;
      }
      render(
        <MemoryRouter initialEntries={["/acme/traces"]}>
          <Host />
        </MemoryRouter>,
      );

      await act(async () => drawers?.openDrawer("first"));
      await act(async () => drawers?.openDrawer("second"));
      await act(async () => drawers?.goBack());
      expect(screen.getByTestId("address")).toHaveTextContent("drawer.open=first");

      await act(async () => {
        void navigate?.(-1);
      });

      expect(screen.getByTestId("address")).toHaveTextContent("drawer.open=second");
    });
  });
});

describe("given an address with a fragment", () => {
  describe("when a drawer is opened from module-level code", () => {
    it("keeps the fragment", async () => {
      window.history.replaceState(null, "", "/acme/traces#lens");
      render(
        <MemoryRouter initialEntries={["/acme/traces#lens"]}>
          <Navigator />
          <Probe />
        </MemoryRouter>,
      );

      await act(async () => {
        navigateToDrawer("traceV2Details");
      });

      expect(screen.getByTestId("address")).toHaveTextContent("?drawer.open=traceV2Details#lens");
    });
  });
});

describe("given an address with a query key that only starts with drawer", () => {
  describe("when a drawer is opened and then closed", () => {
    it("keeps the unrelated key", async () => {
      window.history.replaceState(null, "", "/acme/traces?drawerWidth=wide");
      let drawers: ReturnType<typeof useDrawer> | undefined;
      function Host() {
        drawers = useDrawer();
        return <Probe />;
      }
      render(
        <MemoryRouter initialEntries={["/acme/traces?drawerWidth=wide"]}>
          <Host />
        </MemoryRouter>,
      );

      await act(async () => drawers?.openDrawer("first"));
      expect(screen.getByTestId("address")).toHaveTextContent("drawerWidth=wide");
      expect(screen.getByTestId("address")).toHaveTextContent("drawer.open=first");

      await act(async () => drawers?.closeDrawer());
      expect(screen.getByTestId("address")).toHaveTextContent("drawerWidth=wide");
      expect(screen.getByTestId("address")).not.toHaveTextContent("drawer.open");
    });
  });
});

describe("given an address carrying the parameters of a previously opened drawer", () => {
  describe("when a different drawer is opened for another agent", () => {
    /** @scenario "A stale editor address is cleared before a new one is written" */
    it("leaves only the new drawer's parameters and the reader's other query parameters", async () => {
      const start =
        "/acme/agents?view=grid&drawer.open=agentHttpEditor&drawer.agentId=agent_old&drawer.tab=headers";
      window.history.replaceState(null, "", start);
      let drawers: ReturnType<typeof useDrawer> | undefined;
      function Host() {
        drawers = useDrawer();
        return <Probe />;
      }
      render(
        <MemoryRouter initialEntries={[start]}>
          <Host />
        </MemoryRouter>,
      );

      await act(async () =>
        drawers?.openDrawer("agentCodeEditor", { urlParams: { agentId: "agent_new" } }),
      );

      const address = screen.getByTestId("address").textContent ?? "";
      const params = new URLSearchParams(address.replace(/^\?/, ""));
      expect(params.get("drawer.open")).toBe("agentCodeEditor");
      expect(params.get("drawer.agentId")).toBe("agent_new");
      expect(params.getAll("drawer.agentId")).toEqual(["agent_new"]);
      expect(params.get("view")).toBe("grid");
      expect(params.has("drawer.tab")).toBe(false);
      expect(address).not.toContain("agent_old");
    });
  });
});
