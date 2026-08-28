/**
 * @vitest-environment jsdom
 *
 * What the waterfall reads while a correction is being written: the rows an
 * earlier correction already changed still say so, and removing a row takes its
 * detail pane with it.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";

const mocks = vi.hoisted(() => ({
  storedPatch: null as TraceEditOverlayPatch | null,
}));

vi.mock("../../../../hooks/useTraceEditOverlay", () => ({
  useTraceEditOverlay: () => ({
    data: mocks.storedPatch ? { patch: mocks.storedPatch } : undefined,
  }),
}));

const { useDrawerStore } = await import("@langwatch/trace-web");
const { useTraceEditStore } = await import("@langwatch/trace-web");
const { useCorrectionMarks } = await import("../useCorrectionMarks");
const { useWaterfallEditing } = await import("../useWaterfallEditing");

const spans = [
  { spanId: "span-1", parentSpanId: null, name: "handler" },
  { spanId: "span-2", parentSpanId: "span-1", name: "fetch" },
] as unknown as SpanTreeNode[];

const storedCorrection: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "search the web" }],
  deletedSpanIds: [],
};

beforeEach(() => {
  mocks.storedPatch = null;
  useTraceEditStore.getState().discard();
  useDrawerStore.getState().setIsEditing(false);
  useDrawerStore.getState().clearSpan();
});

describe("given a trace that was already corrected once", () => {
  beforeEach(() => {
    mocks.storedPatch = storedCorrection;
    useDrawerStore.getState().setIsEditing(true);
    useTraceEditStore
      .getState()
      .startEditing({ traceId: "trace-1", basePatch: storedCorrection });
  });

  describe("when a second correction is being written", () => {
    /** @scenario "A rename from an earlier correction still reads while editing" */
    it("lists the span under the name the correction gave it", () => {
      const { result } = renderHook(() => useWaterfallEditing(spans));

      expect(result.current.draftNames.get("span-1")).toBe("search the web");
    });

    /** @scenario "A rename from an earlier correction still reads while editing" */
    it("keeps the row reading as edited", () => {
      const { result } = renderHook(() => useCorrectionMarks(spans));

      expect(result.current.correctedSpanIds.has("span-1")).toBe(true);
      expect(result.current.correctedSpanIds.has("span-2")).toBe(false);
    });

    /** @scenario "A pending rename shows in the waterfall while editing" */
    it("lets this session's rename win over the stored one", () => {
      const { result, rerender } = renderHook(() => useWaterfallEditing(spans));

      act(() => {
        useTraceEditStore.getState().setSpanName({
          spanId: "span-1",
          name: "look it up",
          baselineName: "search the web",
        });
      });
      rerender();

      expect(result.current.draftNames.get("span-1")).toBe("look it up");
    });
  });
});

describe("given a span open in the detail pane while editing", () => {
  beforeEach(() => {
    useDrawerStore.getState().setIsEditing(true);
    useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
    useDrawerStore.getState().selectSpan("span-2");
  });

  describe("when the reviewer deletes it", () => {
    /** @scenario "Deleting the selected span closes its detail pane" */
    it("leaves no span selected", () => {
      const { result } = renderHook(() => useWaterfallEditing(spans));

      act(() => result.current.toggleSpanDeleted("span-2"));

      expect(useDrawerStore.getState().selectedSpanId).toBeNull();
    });
  });
});
