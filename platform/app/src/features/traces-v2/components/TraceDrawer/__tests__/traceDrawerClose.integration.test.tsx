/**
 * @vitest-environment jsdom
 *
 * Closing the trace drawer, against the real drawer stack. The drawer mounts
 * from its own store rather than from the URL, so the shared stack can be
 * describing something else entirely by the time the reader closes it, and
 * walking back through a stack that is not about this drawer is what used to
 * bring a drawer the reader had already left back on screen.
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

vi.mock("~/utils/compat/next-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      tracesV2: {
        header: { cancel: vi.fn() },
        spanTree: { cancel: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/features/traces-v2/hooks/useDrawerUrlSync", () => ({
  useDrawerUrlSync: () => undefined,
}));

vi.mock("~/features/traces-v2/hooks/useSpanTree", () => ({
  useSpanTreeWithCaptured: () => ({
    captured: { data: [] },
    corrected: { data: [], isLoading: false },
    display: { data: [], isLoading: false },
  }),
}));

vi.mock("~/features/traces-v2/hooks/useTraceHeader", () => ({
  useTraceHeader: () => ({ data: null, error: null }),
}));

vi.mock("~/features/traces-v2/hooks/useConversationContext", () => ({
  useConversationContext: () => null,
}));

vi.mock("~/features/traces-v2/hooks/useConversationPrefetch", () => ({
  useConversationPrefetch: () => undefined,
}));

vi.mock("~/features/traces-v2/hooks/usePrefetchSpanDetail", () => ({
  usePrefetchSpanDetail: () => vi.fn(),
}));

vi.mock("~/features/traces-v2/hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({
    navigateToTrace: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
  }),
}));

vi.mock("~/features/traces-v2/hooks/useTraceDrawerShortcuts", () => ({
  useTraceDrawerShortcuts: () => undefined,
}));

vi.mock("~/features/traces-v2/hooks/useTraceRefresh", () => ({
  useTraceRefresh: () => ({ refresh: vi.fn() }),
}));

const { clearDrawerStack, getDrawerStack, useDrawer } = await import("~/hooks/useDrawer");
const { useDrawerStore } = await import("@langwatch/trace-web");
const { useTraceDrawerScaffold } = await import("../useTraceDrawerScaffold");

const TRACE = "trace-1";

function drawerInUrl(): Record<string, string> {
  const drawer: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.startsWith("drawer.")) drawer[key.replace("drawer.", "")] = value;
  });
  return drawer;
}

/** Puts the reader on a trace the way a fresh open leaves things. */
function readerIsOnTrace(traceId: string) {
  useDrawerStore.getState().openTrace(traceId, null);
  window.history.replaceState(
    {},
    "",
    `${harness.PATH}?drawer.open=traceV2Details&drawer.traceId=${traceId}`,
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", harness.PATH);
  clearDrawerStack();
  useDrawerStore.getState().closeDrawer();
});

afterEach(cleanup);

describe("given a trace opened from a simulation run's drawer", () => {
  describe("when I close the trace's drawer", () => {
    /** @scenario "Closing a trace opened from another drawer returns me to that drawer" */
    it("puts the simulation run's drawer back", () => {
      const { result: drawer } = renderHook(() => useDrawer());
      act(() => {
        drawer.current.openDrawer("scenarioRunDetail", {
          urlParams: { scenarioRunId: "run-1" },
        });
        drawer.current.openDrawer("traceV2Details", { traceId: TRACE });
      });
      useDrawerStore.getState().openTrace(TRACE, null);

      const { result } = renderHook(() => useTraceDrawerScaffold());
      act(() => result.current.handleClose());

      expect(drawerInUrl()).toMatchObject({
        open: "scenarioRunDetail",
        scenarioRunId: "run-1",
      });
      expect(useDrawerStore.getState().traceId).toBeNull();
    });
  });
});

describe("given the drawer stack still holds a drawer I already left", () => {
  describe("when I close the trace I am reading", () => {
    /** @scenario "Closing the trace drawer never reopens a drawer I already dismissed" */
    it("closes, and brings nothing else back", () => {
      const { result: drawer } = renderHook(() => useDrawer());
      act(() => {
        drawer.current.openDrawer("traceV2Details", { traceId: "trace-0" });
        drawer.current.openDrawer("addDatasetRecord", { traceId: "trace-0" });
      });
      // The stack is now describing the dataset drawer, and the reader has
      // moved on to reading a trace again.
      expect(getDrawerStack().at(-1)?.drawer).toBe("addDatasetRecord");
      readerIsOnTrace(TRACE);

      const { result } = renderHook(() => useTraceDrawerScaffold());
      act(() => result.current.handleClose());

      expect(drawerInUrl()).toEqual({});
      expect(useDrawerStore.getState().traceId).toBeNull();
    });
  });
});
