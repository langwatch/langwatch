/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

const spans = vi.hoisted(() => ({ current: [] as SpanTreeNode[] }));
const overlay = vi.hoisted(() => ({
  current: null as { patch: TraceEditOverlayPatch } | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: spans.current,
    isFetching: false,
    isPreviousData: false,
  }),
  useQueryClient: () => ({ getQueryData: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      tracesV2: { spanTreeDelta: { invalidate: vi.fn() } },
    }),
    tracesV2: { spanTreeDelta: { useQuery: vi.fn() } },
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

vi.mock("../useTraceEditOverlay", () => ({
  useTraceEditOverlay: () => ({ data: overlay.current }),
  useAppliedTraceEditPatch: () => appliedPatch(),
}));

import { useDrawerStore } from "../../stores/drawerStore";
import { useTraceEditStore } from "../../stores/traceEditStore";
import { useSpanTree } from "../useSpanTree";

function appliedPatch(): TraceEditOverlayPatch | null {
  if (useDrawerStore.getState().isEditing) return null;
  if (useTraceEditStore.getState().overlayView !== "edited") return null;
  return overlay.current?.patch ?? null;
}

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
    useDrawerStore.getState().setIsEditing(false);
    spans.current = [
      node({ spanId: "root" }),
      node({ spanId: "tool", parentSpanId: "root", name: "web_search" }),
      node({ spanId: "child", parentSpanId: "tool" }),
    ];
    overlay.current = {
      patch: {
        version: 1,
        spans: [{ spanId: "root", name: "conversation turn" }],
        deletedSpanIds: ["tool"],
      },
    };
  });

  describe("given a correction that renames one span and deletes another", () => {
    describe("when the reader is on the corrected trace", () => {
      /** @scenario "A deleted span is hidden in the corrected trace" */
      it("drops the deleted span and its descendants", () => {
        const { result } = renderHook(() => useSpanTree());

        expect(result.current.data?.map((s) => s.spanId)).toEqual(["root"]);
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
});
