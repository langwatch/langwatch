// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../../../../__tests__/window-location-router.ts";
import { getTraceDrawer } from "../../../../../behavior/trace-drawer.ts";
import { useTraceHeader } from "../use-trace-header.ts";

const headerData: { traceId?: string; timestamp?: number } = {};
const capturedHeaderInputs: { full?: boolean }[] = [];
const capturedHeaderOptions: { placeholderData?: (previous: unknown) => unknown }[] = [];

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    traces: {
      header: {
        useQuery: (
          input: { full?: boolean },
          options: { placeholderData?: (previous: unknown) => unknown },
        ) => {
          capturedHeaderInputs.push(input);
          capturedHeaderOptions.push(options);
          return { data: headerData, isLoading: false };
        },
      },
    },
    // The header is corrected after it is read; with no correction stored the
    // hook returns the very same object the query produced.
    traceEditOverlay: {
      getByTraceId: { useQuery: () => ({ data: null }) },
    },
  },
}));

vi.mock("../use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({
    isLive: false,
    isReady: true,
    queryArgs: { projectId: "p1", traceId: "trace-1" },
  }),
}));

vi.mock("../use-trace-list-row-header.ts", () => ({
  useTraceListRowHeader: () => () => undefined,
}));

vi.mock("../../../../../behavior/sse-status.store.ts", () => ({
  useSseStatusStore: () => false,
}));

const openTrace = (traceId: string, occurredAtMs?: number) =>
  setWindowAddress({
    url:
      `/acme/traces?drawer.open=traceV2Details&drawer.traceId=${traceId}` +
      (occurredAtMs ? `&drawer.t=${occurredAtMs}` : ""),
  });

describe("useTraceHeader", () => {
  beforeEach(() => {
    headerData.traceId = undefined;
    headerData.timestamp = undefined;
    capturedHeaderInputs.length = 0;
    capturedHeaderOptions.length = 0;
    setWindowAddress({ url: "/acme/traces" });
  });

  describe("given the drawer's own detail read", () => {
    describe("when the drawer opens", () => {
      it("resolves offloaded input/output in full", () => {
        openTrace("trace-1");

        renderHook(() => useTraceHeader());

        expect(capturedHeaderInputs.at(-1)).toMatchObject({ full: true });
      });
    });
  });

  describe("given the drawer opened without a partition hint", () => {
    describe("when the header resolves with a trace timestamp", () => {
      it("backfills occurredAtMs from the resolved timestamp", () => {
        openTrace("trace-1");
        headerData.traceId = "trace-1";
        headerData.timestamp = 1_700_000_000_000;

        renderHook(() => useTraceHeader());

        expect(getTraceDrawer().occurredAtMs).toBe(1_700_000_000_000);
      });
    });
  });

  describe("given the drawer already carries a partition hint", () => {
    describe("when the header resolves with a different timestamp", () => {
      it("leaves the opener-supplied hint untouched", () => {
        openTrace("trace-1", 1_700_000_000_000);
        headerData.traceId = "trace-1";
        headerData.timestamp = 1_699_000_000_000;

        renderHook(() => useTraceHeader());

        expect(getTraceDrawer().occurredAtMs).toBe(1_700_000_000_000);
      });
    });
  });

  describe("given a trace switch leaves stale header data (keepPreviousData)", () => {
    describe("when the lingering header belongs to the previous trace", () => {
      it("does not backfill the new trace with the stale timestamp", () => {
        // Drawer is now on trace-1 (no hint), but React Query still holds
        // the previous trace's header until the new fetch lands.
        openTrace("trace-1");
        headerData.traceId = "trace-OLD";
        headerData.timestamp = 1_699_000_000_000;

        renderHook(() => useTraceHeader());

        expect(getTraceDrawer().occurredAtMs).toBeNull();
      });
    });
  });

  describe("given the reader moves to a trace that has no list row", () => {
    describe("when the read supplies placeholder data", () => {
      it("never paints the previous trace's header", () => {
        openTrace("trace-2");

        renderHook(() => useTraceHeader());

        const previous = { traceId: "trace-1" };
        expect(capturedHeaderOptions.at(-1)?.placeholderData?.(previous)).toBeUndefined();
      });
    });
  });

  describe("given the header has not resolved yet", () => {
    describe("when no timestamp is available", () => {
      it("leaves occurredAtMs null", () => {
        openTrace("trace-1");

        renderHook(() => useTraceHeader());

        expect(getTraceDrawer().occurredAtMs).toBeNull();
      });
    });
  });
});
