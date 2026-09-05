/**
 * @vitest-environment jsdom
 *
 * The drawer back stack, driven through the real hook and the real `qs`
 * serialization. Only the router is harnessed, and it is a faithful one: every
 * push and replace lands in the address bar, so what the next call reads is
 * what the browser would have shown it.
 * See specs/traces-v2/drawer-stacking.feature.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const PATH = "/my-project/traces";
  const navigate = (url: string) => {
    window.history.replaceState({}, "", url);
    return Promise.resolve(true);
  };
  return {
    PATH,
    router: {
      get query() {
        const query: Record<string, string> = {};
        new URLSearchParams(window.location.search).forEach((value, key) => {
          query[key] = value;
        });
        return query;
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

vi.mock("@langwatch/ui-host/use-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

const { clearDrawerStack, getDrawerStack, useDrawer } = await import("../use-drawer");

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
  window.history.replaceState({}, "", harness.PATH);
  clearDrawerStack();
});

afterEach(cleanup);

describe("given a drawer that was already open when the page loaded", () => {
  describe("when I open a second drawer from it and close that one", () => {
    /** @scenario A drawer I arrived on by link is where closing takes me back to */
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

describe("given a dataset drawer open over the traces list", () => {
  describe("when I open another trace from the list behind it", () => {
    /** @scenario Opening a trace over Add to Dataset leaves nothing behind it */
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
