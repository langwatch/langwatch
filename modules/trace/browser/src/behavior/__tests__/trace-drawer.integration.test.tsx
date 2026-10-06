/**
 * The trace drawer is the address: which trace, span and view it shows comes from the
 * URL, and what the drawer changes is written back to it. Only the reader's layout and
 * last choices are remembered elsewhere.
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../__tests__/window-location-router.ts";
import { drawerChrome } from "../drawer-chrome.store.ts";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

const { getTraceDrawer, traceBackStackOf, useTraceDrawer } = await import("../trace-drawer.ts");

const PATH = "/my-project/traces";
const OPEN = `${PATH}?drawer.open=traceV2Details&drawer.traceId=trace-1`;

const drawerParams = (): Record<string, string> => {
  const params: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = value;
  });
  return params;
};

function mountOn(url: string) {
  setWindowAddress({ url });
  return renderHook(() => ({
    isOpen: useTraceDrawer((s) => s.isOpen),
    traceId: useTraceDrawer((s) => s.traceId),
    projectId: useTraceDrawer((s) => s.projectId),
    occurredAtMs: useTraceDrawer((s) => s.occurredAtMs),
    selectedSpanId: useTraceDrawer((s) => s.selectedSpanId),
    viewMode: useTraceDrawer((s) => s.viewMode),
    vizTab: useTraceDrawer((s) => s.vizTab),
    pinnedSpanIds: useTraceDrawer((s) => s.pinnedSpanIds),
    isEditing: useTraceDrawer((s) => s.isEditing),
    expectedSpanCount: useTraceDrawer((s) => s.expectedSpanCount),
  }));
}

beforeEach(() => {
  drawerChrome.setState(drawerChrome.getInitialState(), true);
  setWindowAddress({ url: PATH });
});

afterEach(cleanup);

describe("given an address that names the trace drawer", () => {
  describe("when the drawer reads it", () => {
    /** @scenario "The trace drawer's trace, span and view come from the address" */
    it("takes the trace, project, hint, span, view, tab, pins and edit mode from it", () => {
      const { result } = mountOn(
        `${OPEN}&drawer.projectId=project-9&drawer.t=1700000000000&drawer.span=span-3` +
          "&drawer.mode=conversation&drawer.viz=flame&drawer.pinnedSpans=a,b&drawer.edit=1",
      );

      expect(result.current).toMatchObject({
        isOpen: true,
        traceId: "trace-1",
        projectId: "project-9",
        occurredAtMs: 1700000000000,
        selectedSpanId: "span-3",
        viewMode: "conversation",
        vizTab: "flame",
        pinnedSpanIds: ["a", "b"],
        isEditing: true,
      });
    });

    /** @scenario "A link that names no view opens on the view the reader last chose" */
    it("opens on the reader's last view and tab when the link names none", () => {
      drawerChrome.getState().rememberViewMode("trace");
      drawerChrome.getState().rememberVizTab("flame");

      const { result } = mountOn(OPEN);

      expect(result.current).toMatchObject({ viewMode: "trace", vizTab: "flame" });
    });

    it("drops an unusable timestamp rather than sending it as a hint", () => {
      const { result } = mountOn(`${OPEN}&drawer.t=yesterday`);

      expect(result.current.occurredAtMs).toBeNull();
    });
  });

  describe("when the row that opened it left a span count", () => {
    it("hands the count to that trace only", () => {
      drawerChrome.getState().expectSpanCount({ traceId: "trace-1", count: 42 });

      const { result } = mountOn(OPEN);
      expect(result.current.expectedSpanCount).toBe(42);

      act(() =>
        setWindowAddress({ url: `${PATH}?drawer.open=traceV2Details&drawer.traceId=trace-2` }),
      );
      expect(result.current.expectedSpanCount).toBeNull();
    });
  });
});

describe("given another drawer is open", () => {
  describe("when it carries a trace id of its own", () => {
    it("reads the trace drawer as closed", () => {
      const { result } = mountOn(`${PATH}?drawer.open=addDatasetRecord&drawer.traceId=trace-1`);

      expect(result.current).toMatchObject({ isOpen: false, traceId: null });
    });
  });
});

describe("given the trace drawer is open", () => {
  describe("when a span is selected", () => {
    /** @scenario "What the drawer changes is written back to the address" */
    it("writes it to the address and keeps the rest of it", () => {
      const { result } = mountOn(`${OPEN}&drawer.mode=trace`);

      act(() => getTraceDrawer().selectSpan("span-7"));

      expect(drawerParams()).toMatchObject({
        "drawer.open": "traceV2Details",
        "drawer.traceId": "trace-1",
        "drawer.mode": "trace",
        "drawer.span": "span-7",
      });
      expect(result.current.selectedSpanId).toBe("span-7");
    });

    it("re-opens a collapsed span detail pane", () => {
      mountOn(OPEN);
      drawerChrome.getState().togglePaneCollapsed("spanDetail");

      act(() => getTraceDrawer().selectSpan("span-7"));

      expect(drawerChrome.getState().paneState.spanDetail.collapsed).toBe(false);
    });

    it("clears it again without touching the pane", () => {
      const { result } = mountOn(`${OPEN}&drawer.span=span-7`);

      act(() => getTraceDrawer().clearSpan());

      expect(result.current.selectedSpanId).toBeNull();
      expect(drawerParams()["drawer.span"]).toBeUndefined();
    });
  });

  describe("when several things change in one go", () => {
    it("keeps every one of them", () => {
      const { result } = mountOn(OPEN);

      act(() => {
        getTraceDrawer().selectSpan("span-1");
        getTraceDrawer().setVizTabTransient("topology");
        getTraceDrawer().setViewModeTransient("trace");
      });

      expect(result.current).toMatchObject({
        selectedSpanId: "span-1",
        vizTab: "topology",
        viewMode: "trace",
      });
    });
  });

  describe("when the reader picks a view", () => {
    it("writes it and remembers it for the next trace", () => {
      const { result } = mountOn(OPEN);

      act(() => getTraceDrawer().setViewMode("conversation"));

      expect(result.current.viewMode).toBe("conversation");
      expect(drawerChrome.getState().lastViewMode).toBe("conversation");
    });

    it("leaves what the reader remembered alone when the change is only for this trace", () => {
      drawerChrome.getState().rememberViewMode("summary");
      const { result } = mountOn(OPEN);

      act(() => getTraceDrawer().setViewModeTransient("trace"));

      expect(result.current.viewMode).toBe("trace");
      expect(drawerChrome.getState().lastViewMode).toBe("summary");
    });
  });

  describe("when the link asks for edit mode on a view that cannot be corrected", () => {
    /** @scenario "A link naming annotation mode and a view the pass cannot act on opens on the trace" */
    it("opens on the trace view", () => {
      const { result } = mountOn(`${OPEN}&drawer.mode=terminal&drawer.edit=1`);

      expect(result.current.viewMode).toBe("trace");
    });
  });

  describe("when a span is pinned", () => {
    it("writes the pins in order and stops at the cap", () => {
      const { result } = mountOn(OPEN);

      act(() => {
        for (let i = 1; i <= 10; i++) getTraceDrawer().pinSpan(`span-${i}`);
      });

      expect(result.current.pinnedSpanIds).toHaveLength(8);
      expect(result.current.pinnedSpanIds[0]).toBe("span-1");
    });

    it("clears the selection too when the pinned span is the selected one", () => {
      const { result } = mountOn(`${OPEN}&drawer.pinnedSpans=a,b&drawer.span=a`);

      act(() => getTraceDrawer().unpinSpan("a"));

      expect(result.current).toMatchObject({ pinnedSpanIds: ["b"], selectedSpanId: null });
    });
  });

  describe("when edit mode is turned on and off", () => {
    it("writes it to the address and takes it out again", () => {
      const { result } = mountOn(OPEN);

      act(() => getTraceDrawer().setIsEditing(true));
      expect(result.current.isEditing).toBe(true);

      act(() => getTraceDrawer().setIsEditing(false));
      expect(result.current.isEditing).toBe(false);
      expect(drawerParams()["drawer.edit"]).toBeUndefined();
    });
  });

  describe("when the link carried no timestamp", () => {
    it("fills it in once from the resolved trace, and never over one it has", () => {
      const { result } = mountOn(OPEN);

      act(() => getTraceDrawer().backfillOccurredAtMs(1_700_000_000_000));
      act(() => getTraceDrawer().backfillOccurredAtMs(1_699_000_000_000));

      expect(result.current.occurredAtMs).toBe(1_700_000_000_000);
    });

    it("ignores a timestamp that is not a real one", () => {
      const { result } = mountOn(OPEN);

      act(() => {
        getTraceDrawer().backfillOccurredAtMs(0);
        getTraceDrawer().backfillOccurredAtMs(Number.NaN);
      });

      expect(result.current.occurredAtMs).toBeNull();
    });
  });
});

describe("given no trace drawer is open", () => {
  describe("when the drawer is asked to change something", () => {
    it("leaves the address alone", () => {
      mountOn(`${PATH}?view=table`);

      act(() => getTraceDrawer().selectSpan("span-7"));

      expect(window.location.search).toBe("?view=table");
    });
  });
});

describe("given a stack of drawers beneath the open one", () => {
  const entry = (traceId: string, mode: string, t?: string) => ({
    drawer: "traceV2Details",
    params: { traceId, mode, ...(t ? { t } : {}) },
  });

  describe("when the traces the reader walked through are read", () => {
    /** @scenario "The traces walked through in the drawer are the stack beneath it" */
    it("gives the unbroken run of trace drawers, oldest first, with their view and hint", () => {
      const state = {
        drawerStack: [
          { drawer: "scenarioRunDetail", params: { scenarioRunId: "run-1" } },
          entry("trace-a", "summary", "1700000000000"),
          entry("trace-b", "trace"),
        ],
      };

      expect(traceBackStackOf(state)).toEqual([
        { traceId: "trace-a", viewMode: "summary", occurredAtMs: 1700000000000 },
        { traceId: "trace-b", viewMode: "trace" },
      ]);
    });

    it("is empty when the drawer beneath is not a trace", () => {
      const state = {
        drawerStack: [{ drawer: "scenarioRunDetail", params: { scenarioRunId: "run-1" } }],
      };

      expect(traceBackStackOf(state)).toEqual([]);
    });

    it("is empty when the address carries no stack", () => {
      expect(traceBackStackOf(null)).toEqual([]);
    });
  });
});
