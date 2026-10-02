import type { SpanTreeNode, TraceEditOverlayPatch } from "@langwatch/trace-contract";
// Waterfall during edit: prior corrections remain marked, row removal closes
// detail pane.
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storedPatch: null as TraceEditOverlayPatch | null,
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../hooks/use-trace-edit-overlay.ts", () => ({
  useTraceEditOverlay: () => ({
    data: mocks.storedPatch ? { patch: mocks.storedPatch } : undefined,
  }),
}));

const { getTraceDrawer, useTraceEditStore } = await import("../../../../../../index.ts");
const { openTraceDrawerAt, setWindowAddress } =
  await import("../../../../../../__tests__/window-location-router.ts");
const { useCorrectionMarks } = await import("../use-correction-marks.ts");
const { useWaterfallEditing } = await import("../use-waterfall-editing.ts");

function spanNode(
  over: Partial<SpanTreeNode> & Pick<SpanTreeNode, "spanId" | "parentSpanId">,
): SpanTreeNode {
  return {
    name: "step",
    type: "span",
    startTimeMs: 0,
    endTimeMs: 10,
    durationMs: 10,
    status: "ok",
    model: null,
    ...over,
  };
}

const spans: SpanTreeNode[] = [
  spanNode({ spanId: "span-1", parentSpanId: null, name: "handler" }),
  spanNode({ spanId: "span-2", parentSpanId: "span-1", name: "fetch" }),
];

const storedCorrection: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "search the web" }],
  deletedSpanIds: [],
};

beforeEach(() => {
  mocks.storedPatch = null;
  useTraceEditStore.getState().discard();
  setWindowAddress({ url: "/my-project/traces" });
});

describe("given a trace that was already corrected once", () => {
  beforeEach(() => {
    mocks.storedPatch = storedCorrection;
    openTraceDrawerAt({ edit: "1" });
    useTraceEditStore.getState().startEditing({ traceId: "trace-1", basePatch: storedCorrection });
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
    openTraceDrawerAt({ edit: "1", span: "span-2" });
    useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
  });

  describe("when the reviewer deletes it", () => {
    /** @scenario "Deleting the selected span closes its detail pane" */
    it("leaves no span selected", () => {
      const { result } = renderHook(() => useWaterfallEditing(spans));

      act(() => result.current.toggleSpanDeleted("span-2"));

      expect(getTraceDrawer().selectedSpanId).toBeNull();
    });
  });
});
