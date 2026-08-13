/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

const spans = vi.hoisted(() => ({ current: [] as SpanTreeNode[] }));
const overlay = vi.hoisted(() => ({
  current: null as { traceId: string; patch: TraceEditOverlayPatch } | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: spans.current,
    isFetching: false,
    isPreviousData: false,
  }),
  useQueryClient: () => ({ getQueryData: vi.fn(), setQueryData: vi.fn() }),
}));

// The correction arrives the way the drawer receives it, through the query the
// real `useTraceEditOverlay` reads, so the hook under test runs against the
// production overlay hooks rather than a stand-in for them.
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      tracesV2: { spanTreeDelta: { invalidate: vi.fn() } },
    }),
    tracesV2: { spanTreeDelta: { useQuery: vi.fn() } },
    traceEditOverlay: {
      getByTraceId: { useQuery: () => ({ data: overlay.current }) },
    },
  },
}));

vi.mock("../../context/SharedTraceContext", () => ({
  useSharedTrace: () => null,
  asSharedQueryResult: (data: unknown) => ({ data }),
}));

vi.mock("../spanTreePagedQuery", () => ({
  spanTreeQueryKey: () => ["spanTree", "trace-1"],
  spanTreeQueryFn: () => vi.fn(),
  spanTreeDeltaSinceMs: () => 0,
  mergeSpanTreeDelta: (existing: unknown) => existing,
}));

vi.mock("../useTraceQueryArgs", () => ({
  useTraceQueryArgs: () => ({
    isLive: false,
    isReady: true,
    queryArgs: { projectId: "project-1", traceId: "trace-1" },
  }),
}));

import { useDrawerStore } from "../../stores/drawerStore";
import { useTraceEditStore } from "../../stores/traceEditStore";
import { useSpanTree, useSpanTreeWithCaptured } from "../useSpanTree";

function node(over: { spanId: string; parentSpanId?: string; name?: string }) {
  return {
    spanId: over.spanId,
    parentSpanId: over.parentSpanId ?? null,
    name: over.name ?? over.spanId,
    type: "span",
    startTimeMs: 0,
    endTimeMs: 1,
    durationMs: 1,
    status: "ok",
  } as unknown as SpanTreeNode;
}

describe("useSpanTree with a correction", () => {
  beforeEach(() => {
    useTraceEditStore.getState().discard();
    // `discard` clears the editing session, not which reading is on screen, so
    // the view a test switches would otherwise carry into the ones after it.
    useTraceEditStore.getState().setOverlayView("edited");
    useDrawerStore.getState().setIsEditing(false);
    spans.current = [
      node({ spanId: "root" }),
      node({ spanId: "tool", parentSpanId: "root", name: "web_search" }),
      node({ spanId: "child", parentSpanId: "tool" }),
    ];
    overlay.current = {
      traceId: "trace-1",
      patch: {
        version: 1,
        spans: [{ spanId: "root", name: "conversation turn" }],
        deletedSpanIds: ["tool"],
      },
    };
  });

  describe("given a correction that renames one span and deletes another", () => {
    describe("when the reader is on the corrected trace", () => {
      /** @scenario "A deleted span is not part of the corrected trace" */
      it("drops the deleted span and its descendants", () => {
        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data?.map((s) => s.spanId)).toEqual(["root"]);
      });

      /** @scenario "A deleted span is listed and struck through in the corrected trace" */
      it("keeps them on the tree the drawer draws, for it to strike through", () => {
        const { result } = renderHook(() => useSpanTreeWithCaptured());

        expect(result.current.display.data?.map((s) => s.spanId)).toEqual([
          "root",
          "tool",
          "child",
        ]);
      });

      /** @scenario "A deleted span is listed and struck through in the corrected trace" */
      it("leaves a removed row saying what the trace had, not what the edit renamed", () => {
        // The same correction renames the span it deletes. A row whose whole
        // point is showing what the trace had must not be dressed up by it.
        overlay.current = {
          traceId: "trace-1",
          patch: {
            version: 1,
            spans: [
              { spanId: "root", name: "conversation turn" },
              { spanId: "tool", name: "search the web" },
            ],
            deletedSpanIds: ["tool"],
          },
        };

        const { result } = renderHook(() => useSpanTreeWithCaptured());
        const removed = result.current.display.data?.find(
          (s) => s.spanId === "tool",
        );
        const kept = result.current.display.data?.find(
          (s) => s.spanId === "root",
        );

        expect(removed?.name).toBe("web_search");
        // The rename still lands on the rows the correction kept.
        expect(kept?.name).toBe("conversation turn");
      });

      /** @scenario "The corrected trace is what the reader sees by default" */
      it("reads the renamed span with its corrected name", () => {
        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data?.[0]?.name).toBe("conversation turn");
      });
    });

    describe("when the reader switches to the captured trace", () => {
      /** @scenario "Switching to the captured trace shows the original values" */
      it("reads every span exactly as captured", () => {
        useTraceEditStore.getState().setOverlayView("original");

        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data?.map((s) => s.spanId)).toEqual([
          "root",
          "tool",
          "child",
        ]);
        expect(result.current.data?.[0]?.name).toBe("root");
      });
    });

    describe("when the reviewer is editing", () => {
      it("reads the captured trace so the correction is not applied twice", () => {
        useDrawerStore.getState().setIsEditing(true);

        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data?.map((s) => s.spanId)).toEqual([
          "root",
          "tool",
          "child",
        ]);
      });
    });
  });

  describe("given a trace with no correction", () => {
    describe("when the span tree is read", () => {
      it("returns the very same array it was given", () => {
        overlay.current = null;

        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data).toBe(spans.current);
      });
    });
  });

  describe("given the previous trace's correction is still in the cache", () => {
    describe("when the reader has already switched to another trace", () => {
      it("reads the open trace exactly as captured", () => {
        overlay.current = {
          traceId: "trace-0",
          patch: {
            version: 1,
            spans: [{ spanId: "root", name: "the other trace's name" }],
            deletedSpanIds: ["tool"],
          },
        };

        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data).toBe(spans.current);
      });
    });
  });
});
