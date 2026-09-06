/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDrawerStack,
  clearFlowCallbacks,
  useDrawer,
  useUpdateDrawerParams,
} from "../useDrawer";

const mockPush = vi.fn();
const mockReplace = vi.fn();

/**
 * The hash React Router still believes the page is on. The traces bar state
 * moves the real fragment with a raw `history.replaceState`, which the router
 * never observes, so its copy lags behind from the first filter edit onwards.
 */
let staleRouterHash = "";
let routerQuery: Record<string, string> = {};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: routerQuery,
    pathname: "/acme/traces",
    asPath:
      "/acme/traces" +
      (Object.keys(routerQuery).length > 0
        ? "?" + new URLSearchParams(routerQuery).toString()
        : "") +
      staleRouterHash,
    push: mockPush,
    replace: mockReplace,
  }),
}));

describe("useDrawer URL fragment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerQuery = {};
    staleRouterHash = "";
    window.history.replaceState({}, "", "/acme/traces");
    clearDrawerStack();
    clearFlowCallbacks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the traces page moved the fragment behind React Router's back", () => {
    beforeEach(() => {
      // What the user did: opened the Conversations lens (a router
      // navigation, so the router saw it), then narrowed the window to 24
      // hours (a raw replaceState, so it did not).
      staleRouterHash = "#conversations";
      window.history.replaceState(
        {},
        "",
        "/acme/traces#conversations?preset=24h",
      );
    });

    describe("when a drawer is opened", () => {
      it("republishes the fragment the browser is actually on", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.openDrawer("traceV2Details", { traceId: "trace-1" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).toContain("drawer.open=traceV2Details");
        expect(pushed).toContain("#conversations?preset=24h");
      });
    });

    describe("when the drawer is closed", () => {
      it("republishes the fragment the browser is actually on", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.closeDrawer();
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).toContain("#conversations?preset=24h");
      });
    });

    describe("when drawer params are updated", () => {
      it("republishes the fragment the browser is actually on", () => {
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).toContain("#conversations?preset=24h");
      });
    });
  });

  describe("given the browser and the router agree on the fragment", () => {
    beforeEach(() => {
      staleRouterHash = "#conversations";
      window.history.replaceState({}, "", "/acme/traces#conversations");
    });

    describe("when a drawer is opened", () => {
      it("keeps that fragment", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.openDrawer("traceV2Details", { traceId: "trace-1" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).toContain("#conversations");
        expect(pushed).not.toContain("preset");
      });
    });
  });

  describe("given no fragment at all", () => {
    describe("when a drawer is opened", () => {
      it("pushes a URL without one", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.openDrawer("traceV2Details", { traceId: "trace-1" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).not.toContain("#");
      });
    });
  });

  describe("given the router already knows about a fragment carrying bar state", () => {
    beforeEach(() => {
      // A full page load on a shared link: React Router sees the whole
      // fragment, `preset` and all, so nothing is stale here.
      staleRouterHash = "#all-traces?preset=24h";
      window.history.replaceState({}, "", "/acme/traces#all-traces?preset=24h");
    });

    describe("when a drawer is opened", () => {
      it("leaves the bar state in the fragment instead of copying it into the query", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.openDrawer("traceV2Details", { traceId: "trace-1" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).toContain("#all-traces?preset=24h");
        const [beforeHash] = pushed.split("#");
        expect(beforeHash).not.toContain("preset");
      });
    });
  });

  describe("given drawer params were parked after the fragment", () => {
    beforeEach(() => {
      // The case the fragment/query split exists for: a malformed URL where
      // `drawer.*` sits after the `#`, where `router.query` cannot see it.
      staleRouterHash = "#conversations?drawer.open=traceV2Details";
      window.history.replaceState(
        {},
        "",
        "/acme/traces#conversations?drawer.open=traceV2Details",
      );
    });

    describe("when drawer params are updated", () => {
      it("still lifts them back into the real query string", () => {
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        const [beforeHash] = pushed.split("#");
        expect(beforeHash).toContain("drawer.open=traceV2Details");
        expect(beforeHash).toContain("drawer.mode=conversation");
      });

      it("leaves no copy of them behind in the fragment", () => {
        // Lifting a param out of the fragment has to remove it from there too.
        // A leftover `drawer.open` in the fragment is a stale snapshot that the
        // next drawer navigation lifts again — closing the drawer and then
        // opening another one would resurrect the old one.
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        expect(pushed).toContain("#conversations");
        const afterHash = pushed.slice(pushed.indexOf("#"));
        expect(afterHash).toBe("#conversations");
      });
    });
  });

  describe("given the fragment carries both bar state and a parked drawer param", () => {
    beforeEach(() => {
      // The realistic version of the malformed shape: the user has already
      // narrowed the window, so the bar's `preset` is sitting in the fragment
      // when a `drawer.` param gets parked alongside it.
      staleRouterHash = "#conversations?preset=24h&drawer.open=traceV2Details";
      window.history.replaceState(
        {},
        "",
        "/acme/traces#conversations?preset=24h&drawer.open=traceV2Details",
      );
    });

    describe("when drawer params are updated", () => {
      it("lifts only the drawer param into the real query string", () => {
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        const [beforeHash] = pushed.split("#");
        expect(beforeHash).toContain("drawer.open=traceV2Details");
        expect(beforeHash).toContain("drawer.mode=conversation");
        expect(beforeHash).not.toContain("preset");
      });

      it("leaves the bar state in the fragment", () => {
        // Carrying `preset` out of the fragment is the bug this whole file
        // exists to fix — the traces bar reads the time range from there, and
        // loses it the moment something else takes it away.
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        const afterHash = pushed.slice(pushed.indexOf("#"));
        expect(afterHash).toBe("#conversations?preset=24h");
      });
    });
  });

  describe("given drawer params were parked after the fragment of a URL that already had a query", () => {
    beforeEach(() => {
      // Same malformed shape, but with a real query string in front of the
      // `#`. The two orderings used to be parsed by different branches, and
      // only one of them rescued `drawer.` params — so a filter on the URL
      // was enough to strand the drawer after the fragment.
      routerQuery = { filter: "active" };
      staleRouterHash = "#conversations?drawer.open=traceV2Details";
      window.history.replaceState(
        {},
        "",
        "/acme/traces?filter=active#conversations?drawer.open=traceV2Details",
      );
    });

    describe("when drawer params are updated", () => {
      it("lifts them back into the real query string", () => {
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        const [beforeHash] = pushed.split("#");
        expect(beforeHash).toContain("drawer.open=traceV2Details");
        expect(beforeHash).toContain("drawer.mode=conversation");
      });

      it("keeps the query that was already there", () => {
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        const [beforeHash] = pushed.split("#");
        expect(beforeHash).toContain("filter=active");
      });

      it("leaves no copy of them behind in the fragment", () => {
        const { result } = renderHook(() => useUpdateDrawerParams());

        act(() => {
          result.current({ mode: "conversation" });
        });

        const pushed = mockPush.mock.calls[0]?.[0] as string;
        const afterHash = pushed.slice(pushed.indexOf("#"));
        expect(afterHash).toBe("#conversations");
      });
    });
  });
});
