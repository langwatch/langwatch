/**
 * @vitest-environment jsdom
 *
 * The drawer back stack, driven through the real hook and the real `qs`
 * serialization. Only the router is harnessed, and it is a faithful one: every
 * push and replace lands in the address bar, so what the next call reads is
 * what the browser would have shown it. `snapshotQuery` freezes the router's
 * `query` at an older URL, which is the one thing a real render snapshot does
 * that a live read never would.
 * See specs/traces-v2/drawer-stacking.feature.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const PATH = "/my-project/traces";
  /** Freezes what the router reports as its query, whatever the URL says. */
  let frozenQuery: Record<string, string> | null = null;
  const liveQuery = (): Record<string, string> => {
    const query: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
      query[key] = value;
    });
    return query;
  };
  const navigate = (url: string) => {
    window.history.replaceState({}, "", url);
    return Promise.resolve(true);
  };
  return {
    PATH,
    snapshotQuery: () => {
      frozenQuery = liveQuery();
    },
    thawQuery: () => {
      frozenQuery = null;
    },
    router: {
      get query() {
        return frozenQuery ?? liveQuery();
      },
      pathname: "/[project]/traces",
      get asPath() {
        return window.location.pathname + window.location.search;
      },
      push: navigate,
      replace: navigate,
    },
  };
});

vi.mock("~/utils/compat/next-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

const { clearDrawerStack, getDrawerStack, useDrawer } = await import("../useDrawer");

/** What the address bar holds for the drawer, as the browser would show it. */
function drawerInUrl(): Record<string, string> {
  const drawer: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.startsWith("drawer.")) drawer[key.replace("drawer.", "")] = value;
  });
  return drawer;
}

function openTraceDrawerOn(traceId: string) {
  const { result } = renderHook(() => useDrawer());
  act(() => {
    result.current.openDrawer("traceV2Details", { traceId, t: "1700000000" });
  });
  return result;
}

beforeEach(() => {
  harness.thawQuery();
  window.history.replaceState({}, "", harness.PATH);
  clearDrawerStack();
});

afterEach(cleanup);

describe("given a dataset drawer opened from the trace I am reading", () => {
  describe("when I close the dataset drawer", () => {
    /** @scenario "Closing Add to Dataset opened from a trace returns me to that trace" */
    it("puts the trace's drawer back, with the state it had", () => {
      const result = openTraceDrawerOn("trace-1");
      act(() => {
        result.current.openDrawer("addDatasetRecord", { traceId: "trace-1" });
      });

      act(() => result.current.goBack());

      expect(drawerInUrl()).toMatchObject({
        open: "traceV2Details",
        traceId: "trace-1",
        t: "1700000000",
      });
    });
  });
});

describe("given a dataset drawer opened from a selection in the traces list", () => {
  describe("when I close the dataset drawer", () => {
    /** @scenario "Closing Add to Dataset opened from the traces list closes it outright" */
    it("leaves no drawer open", () => {
      const { result } = renderHook(() => useDrawer());
      act(() => {
        result.current.openDrawer("addDatasetRecord", {
          selectedTraceIds: ["trace-1", "trace-2"],
        });
      });

      act(() => result.current.goBack());

      expect(drawerInUrl()).toEqual({});
      expect(getDrawerStack()).toHaveLength(0);
    });
  });
});

describe("given a drawer that was already open when the page loaded", () => {
  describe("when I open a second drawer from it and close that one", () => {
    /** @scenario "A drawer I arrived on by link is where closing takes me back to" */
    it("returns to the drawer the link opened", () => {
      window.history.replaceState(
        {},
        "",
        `${harness.PATH}?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run-1`,
      );
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("traceV2Details", { traceId: "trace-1" });
      });
      act(() => result.current.goBack());

      expect(drawerInUrl()).toMatchObject({
        open: "scenarioRunDetail",
        scenarioRunId: "run-1",
      });
    });
  });
});

describe("given a drawer I dismissed earlier in the session", () => {
  describe("when a later drawer reads the address bar behind a stale snapshot", () => {
    /** @scenario "Closing the trace drawer never reopens a drawer I already dismissed" */
    it("never seeds the dismissed drawer back onto the stack", () => {
      const { result } = renderHook(() => useDrawer());
      act(() => {
        result.current.openDrawer("addDatasetRecord", { traceId: "trace-1" });
      });
      // Whoever opens the next drawer may still be holding the render from
      // before the close, which is where the resurrect used to come from.
      harness.snapshotQuery();
      act(() => result.current.closeDrawer());

      act(() => {
        result.current.openDrawer("traceV2Details", { traceId: "trace-2" });
      });

      expect(getDrawerStack().map((entry) => entry.drawer)).toEqual(["traceV2Details"]);

      harness.thawQuery();
      act(() => result.current.goBack());

      expect(drawerInUrl()).toEqual({});
    });
  });
});

describe("given a dataset drawer open over the traces list", () => {
  describe("when I open another trace from the list behind it", () => {
    /** @scenario "Opening a trace over Add to Dataset leaves nothing behind it" */
    it("leaves nothing behind that trace to walk back into", () => {
      const result = openTraceDrawerOn("trace-1");
      act(() => {
        result.current.openDrawer("addDatasetRecord", { traceId: "trace-1" });
      });

      act(() => {
        result.current.openDrawer("traceV2Details", { traceId: "trace-2" });
      });

      expect(getDrawerStack().map((entry) => entry.drawer)).toEqual(["traceV2Details"]);

      act(() => result.current.goBack());

      expect(drawerInUrl()).toEqual({});
    });
  });
});
