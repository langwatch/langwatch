/**
 * @vitest-environment jsdom
 *
 * Which view carries the marks a correction leaves. The corrected trace is where
 * a reader goes to see what the correction did, so a removal is legible there;
 * the captured trace is the trace as it arrived and says nothing about it.
 *
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  overlayView: "edited" as "edited" | "original",
  isEditing: false,
  patch: null as unknown,
}));

vi.mock("../../../hooks/use-trace-edit-overlay", () => ({
  useTraceEditOverlay: () => ({ data: { patch: harness.patch } }),
}));

vi.mock("../../../../../../behavior/drawer.store", () => ({
  useDrawerStore: (selector: (s: unknown) => unknown) => selector({ isEditing: harness.isEditing }),
}));

vi.mock("../../../../../../behavior/trace-edit.store", () => ({
  useTraceEditStore: (selector: (s: unknown) => unknown) =>
    selector({ overlayView: harness.overlayView, basePatch: null }),
}));

import type { SpanTreeNode } from "@langwatch/trace-contract";
import { useCorrectionMarks } from "../use-correction-marks";

const SPANS = [
  { spanId: "root", parentSpanId: null },
  { spanId: "removed", parentSpanId: "root" },
  { spanId: "kept", parentSpanId: "root" },
] as unknown as SpanTreeNode[];

/** A stored correction that removes one span and renames another. */
const PATCH = {
  deletedSpanIds: ["removed"],
  spans: [{ spanId: "kept", name: "renamed" }],
};

/** The same correction, on a span it renames before removing it. */
const RENAMED_THEN_REMOVED = {
  deletedSpanIds: ["removed"],
  spans: [{ spanId: "removed", name: "renamed" }],
};

beforeEach(() => {
  harness.overlayView = "edited";
  harness.isEditing = false;
  harness.patch = PATCH;
});

describe("given a correction that removes a span", () => {
  describe("when the reader is on the corrected trace", () => {
    /** @scenario "A deleted span is listed and struck through in the corrected trace" */
    it("marks the removed span so the row can say so", () => {
      const { result } = renderHook(() => useCorrectionMarks(SPANS));

      expect(result.current.deletedByCorrectionSpanIds.has("removed")).toBe(true);
      expect(result.current.deletedByCorrectionSpanIds.has("kept")).toBe(false);
    });
  });

  describe("when the reader is on the captured trace", () => {
    /** @scenario "A deleted span reads plainly in the captured trace" */
    it("marks nothing, because the trace as it arrived says nothing about it", () => {
      harness.overlayView = "original";

      const { result } = renderHook(() => useCorrectionMarks(SPANS));

      expect(result.current.deletedByCorrectionSpanIds.size).toBe(0);
    });

    /** @scenario "A deleted span reads plainly in the captured trace" */
    it("does not colour the removed span as changed, since no value changed", () => {
      harness.overlayView = "original";

      const { result } = renderHook(() => useCorrectionMarks(SPANS));

      expect(result.current.correctedSpanIds.has("removed")).toBe(false);
      expect(result.current.correctedSpanIds.has("kept")).toBe(true);
    });

    /** @scenario "A span the correction both changes and deletes still reads as changed" */
    it("colours a span it renamed before removing", () => {
      harness.overlayView = "original";
      harness.patch = RENAMED_THEN_REMOVED;

      const { result } = renderHook(() => useCorrectionMarks(SPANS));

      expect(result.current.correctedSpanIds.has("removed")).toBe(true);
    });
  });

  describe("when the reviewer is writing the correction", () => {
    it("marks nothing, because the editing marks already say what is going", () => {
      harness.isEditing = true;

      const { result } = renderHook(() => useCorrectionMarks(SPANS));

      expect(result.current.deletedByCorrectionSpanIds.size).toBe(0);
    });
  });
});

describe("given a trace with no correction", () => {
  describe("when the reader is on the corrected trace", () => {
    it("marks nothing at all", () => {
      harness.patch = null;

      const { result } = renderHook(() => useCorrectionMarks(SPANS));

      expect(result.current.deletedByCorrectionSpanIds.size).toBe(0);
      expect(result.current.correctedSpanIds.size).toBe(0);
    });
  });
});
