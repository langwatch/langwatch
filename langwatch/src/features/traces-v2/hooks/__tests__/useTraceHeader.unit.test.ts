// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDrawerStore } from "../../stores/drawerStore";
import { useTraceHeader } from "../useTraceHeader";

const headerData: { timestamp?: number } = {};

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      header: {
        useQuery: () => ({ data: headerData, isLoading: false }),
      },
    },
  },
}));

vi.mock("../useTraceQueryArgs", () => ({
  useTraceQueryArgs: () => ({
    isLive: false,
    isReady: true,
    queryArgs: { projectId: "p1", traceId: "trace-1" },
  }),
}));

vi.mock("../../stores/sseStatusStore", () => ({
  useSseStatusStore: () => false,
}));

describe("useTraceHeader", () => {
  beforeEach(() => {
    headerData.timestamp = undefined;
    useDrawerStore.setState({ traceId: null, occurredAtMs: null });
  });

  describe("given the drawer opened without a partition hint", () => {
    describe("when the header resolves with a trace timestamp", () => {
      it("backfills occurredAtMs from the resolved timestamp", () => {
        useDrawerStore.getState().openTrace("trace-1");
        headerData.timestamp = 1_700_000_000_000;

        renderHook(() => useTraceHeader());

        expect(useDrawerStore.getState().occurredAtMs).toBe(1_700_000_000_000);
      });
    });
  });

  describe("given the drawer already carries a partition hint", () => {
    describe("when the header resolves with a different timestamp", () => {
      it("leaves the opener-supplied hint untouched", () => {
        useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000);
        headerData.timestamp = 1_699_000_000_000;

        renderHook(() => useTraceHeader());

        expect(useDrawerStore.getState().occurredAtMs).toBe(1_700_000_000_000);
      });
    });
  });

  describe("given the header has not resolved yet", () => {
    describe("when no timestamp is available", () => {
      it("leaves occurredAtMs null", () => {
        useDrawerStore.getState().openTrace("trace-1");

        renderHook(() => useTraceHeader());

        expect(useDrawerStore.getState().occurredAtMs).toBeNull();
      });
    });
  });
});
