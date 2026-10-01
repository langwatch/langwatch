/**
 * Closing the trace drawer, against the real drawer stack in the address.
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../../../../__tests__/window-location-router.ts";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    useUtils: () => ({
      traces: {
        header: { cancel: vi.fn() },
        spanTree: { cancel: vi.fn() },
      },
    }),
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    scenarios: {
      getRunState: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
  },
}));

vi.mock("../../hooks/use-span-tree.ts", () => ({
  useSpanTreeWithCaptured: () => ({
    captured: { data: [] },
    corrected: { data: [], isLoading: false },
    display: { data: [], isLoading: false },
  }),
}));

vi.mock("../../hooks/use-trace-header.ts", () => ({
  useTraceHeader: () => ({ data: null, error: null }),
}));

vi.mock("../../hooks/use-conversation-context.ts", () => ({
  useConversationContext: () => null,
}));

vi.mock("../../hooks/use-conversation-prefetch.ts", () => ({
  useConversationPrefetch: () => undefined,
}));

vi.mock("../../hooks/use-prefetch-span-detail.ts", () => ({
  usePrefetchSpanDetail: () => vi.fn(),
}));

vi.mock("../../hooks/use-trace-drawer-navigation.ts", () => ({
  useTraceDrawerNavigation: () => ({
    navigateToTrace: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
  }),
}));

vi.mock("../../hooks/use-trace-drawer-shortcuts.ts", () => ({
  useTraceDrawerShortcuts: () => undefined,
}));

vi.mock("../../hooks/use-trace-refresh.ts", () => ({
  useTraceRefresh: () => ({ refresh: vi.fn() }),
}));

const { getDrawerStack, useDrawer } = await import("@langwatch/browser-host/use-drawer");
const { getTraceDrawer } = await import("../../../../../behavior/trace-drawer.ts");
const { useTraceDrawerScaffold } = await import("../use-trace-drawer-scaffold.ts");

const PATH = "/my-project/traces";
const TRACE = "trace-1";

function drawerInUrl(): Record<string, string> {
  const drawer: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.startsWith("drawer.")) drawer[key.replace("drawer.", "")] = value;
  });
  return drawer;
}

beforeEach(() => {
  setWindowAddress({ url: PATH });
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
      });
      act(() => {
        drawer.current.openDrawer("traceV2Details", { traceId: TRACE });
      });

      const { result } = renderHook(() => useTraceDrawerScaffold());
      act(() => result.current.handleClose());

      expect(drawerInUrl()).toMatchObject({
        open: "scenarioRunDetail",
        scenarioRunId: "run-1",
      });
      expect(getTraceDrawer().traceId).toBeNull();
    });
  });
});

describe("given the reader walked back to a trace through other drawers", () => {
  describe("when I close the trace I am reading", () => {
    /** @scenario "Closing the trace drawer never reopens a drawer I already dismissed" */
    it("closes, and brings nothing else back", () => {
      const { result: drawer } = renderHook(() => useDrawer());
      act(() => {
        drawer.current.openDrawer("traceV2Details", { traceId: "trace-0" });
      });
      act(() => {
        drawer.current.openDrawer("addDatasetRecord", { traceId: "trace-0" });
      });
      expect(getDrawerStack().at(-1)?.drawer).toBe("addDatasetRecord");
      // Opening a trace again returns to the trace entry already in the stack,
      // so the dataset drawer is not left beneath it.
      act(() => {
        drawer.current.openDrawer("traceV2Details", { traceId: TRACE });
      });

      const { result } = renderHook(() => useTraceDrawerScaffold());
      act(() => result.current.handleClose());

      expect(drawerInUrl()).toEqual({});
      expect(getTraceDrawer().traceId).toBeNull();
    });
  });
});
