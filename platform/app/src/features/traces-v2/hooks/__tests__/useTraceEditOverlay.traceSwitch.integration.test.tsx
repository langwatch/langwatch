/**
 * @vitest-environment jsdom
 *
 * The overlay read keeps the previous trace's data while the next one is in
 * flight, so the hook has to say which trace the correction it is holding
 * belongs to. Without that, opening a second trace reads the first one's
 * correction as its own and adopts it as an editing baseline.
 * See specs/traces-v2/trace-edit-overlay.feature.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

const openTraceId = vi.hoisted(() => ({ current: "trace-2" }));
const overlayRow = vi.hoisted(() => ({
  current: null as { traceId: string; patch: TraceEditOverlayPatch } | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    traceEditOverlay: {
      getByTraceId: {
        useQuery: () => ({ data: overlayRow.current, isLoading: false }),
      },
    },
  },
}));

vi.mock("../../context/SharedTraceContext", () => ({
  useSharedTrace: () => null,
}));

vi.mock("../useTraceQueryArgs", () => ({
  useTraceQueryArgs: () => ({
    isReady: true,
    queryArgs: { projectId: "project-1", traceId: openTraceId.current },
  }),
}));

import { useDrawerStore } from "../../stores/drawerStore";
import { useTraceEditStore } from "../../stores/traceEditStore";
import {
  useAppliedTraceEditPatch,
  useTraceEditOverlay,
} from "../useTraceEditOverlay";

const patch = (name: string): TraceEditOverlayPatch => ({
  version: 1,
  spans: [{ spanId: "span-1", name }],
  deletedSpanIds: [],
});

beforeEach(() => {
  openTraceId.current = "trace-2";
  overlayRow.current = null;
  useTraceEditStore.getState().setOverlayView("edited");
  useDrawerStore.getState().setIsEditing(false);
});

describe("given the drawer moved on to another trace", () => {
  describe("when the previous trace's correction is still in the query cache", () => {
    it("hands over no correction for the trace under view", () => {
      overlayRow.current = { traceId: "trace-1", patch: patch("renamed") };

      const { result } = renderHook(() => useTraceEditOverlay());

      expect(result.current.data).toBeNull();
    });

    it("applies nothing to what the reader is looking at", () => {
      overlayRow.current = { traceId: "trace-1", patch: patch("renamed") };

      const { result } = renderHook(() => useAppliedTraceEditPatch());

      expect(result.current).toBeNull();
    });
  });

  describe("when the read for the trace under view lands", () => {
    it("hands over that trace's correction", () => {
      overlayRow.current = { traceId: "trace-2", patch: patch("renamed") };

      const { result } = renderHook(() => useAppliedTraceEditPatch());

      expect(result.current).toEqual(patch("renamed"));
    });
  });
});
