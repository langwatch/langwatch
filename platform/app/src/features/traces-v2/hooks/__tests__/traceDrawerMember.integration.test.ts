/**
 * @vitest-environment jsdom
 *
 * ADR-144 block F: the drawer stays on the member it opened on. On an
 * aggregate two members may hold the same trace id, so walking to the next
 * turn, going back, and reloading from the link all keep the member the row
 * named, instead of falling back to whichever member sorts first.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDrawerStore } from "../../stores/drawerStore";
import { useTraceDrawerNavigation } from "../useTraceDrawerNavigation";
import { useTraceDrawerUrlHydrator } from "../useTraceDrawerUrlHydrator";

const { openDrawerMock, drawer } = vi.hoisted(() => ({
  openDrawerMock: vi.fn(),
  drawer: {
    current: "traceV2Details" as string | undefined,
    params: {} as Record<string, string | undefined>,
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: openDrawerMock,
    closeDrawer: vi.fn(),
    currentDrawer: drawer.current,
  }),
  useDrawerParams: () => drawer.params,
}));

const MEMBER = "project-member";

beforeEach(() => {
  openDrawerMock.mockClear();
  useDrawerStore.getState().closeDrawer();
  drawer.current = "traceV2Details";
  drawer.params = {};
});

describe("given a drawer open on a member's trace under an aggregate", () => {
  beforeEach(() => {
    useDrawerStore
      .getState()
      .openTrace("trace-first", 1_000, { tenantId: MEMBER });
  });

  describe("when the reader walks to the next turn", () => {
    it("opens it on the same member and names the member in the link", () => {
      const { result } = renderHook(() => useTraceDrawerNavigation());

      act(() => {
        result.current.navigateToTrace({
          fromTraceId: "trace-first",
          fromViewMode: "trace",
          fromTimestamp: 1_000,
          toTraceId: "trace-next",
          toTimestamp: 2_000,
        });
      });

      expect(useDrawerStore.getState()).toMatchObject({
        traceId: "trace-next",
        tenantId: MEMBER,
      });
      expect(openDrawerMock).toHaveBeenLastCalledWith("traceV2Details", {
        traceId: "trace-next",
        t: "2000",
        tenantId: MEMBER,
      });
    });
  });

  describe("when the reader goes back", () => {
    it("reopens the previous trace on the member it was read on", () => {
      const { result } = renderHook(() => useTraceDrawerNavigation());
      act(() => {
        result.current.navigateToTrace({
          fromTraceId: "trace-first",
          fromViewMode: "trace",
          fromTimestamp: 1_000,
          toTraceId: "trace-next",
          toTimestamp: 2_000,
        });
      });

      act(() => {
        result.current.goBack();
      });

      expect(useDrawerStore.getState()).toMatchObject({
        traceId: "trace-first",
        tenantId: MEMBER,
      });
      expect(openDrawerMock).toHaveBeenLastCalledWith("traceV2Details", {
        traceId: "trace-first",
        t: "1000",
        tenantId: MEMBER,
      });
    });
  });
});

describe("given a link to a member's trace under an aggregate", () => {
  describe("when the page loads it", () => {
    it("opens the drawer on the member the link names", () => {
      drawer.params = { traceId: "trace-twin", t: "3000", tenantId: MEMBER };

      renderHook(() => useTraceDrawerUrlHydrator());

      expect(useDrawerStore.getState()).toMatchObject({
        traceId: "trace-twin",
        occurredAtMs: 3_000,
        tenantId: MEMBER,
      });
    });
  });
});

describe("given a drawer open on a plain project's trace", () => {
  describe("when the reader walks to the next turn", () => {
    it("names no member, so the link is unchanged", () => {
      useDrawerStore.getState().openTrace("trace-first", 1_000);
      const { result } = renderHook(() => useTraceDrawerNavigation());

      act(() => {
        result.current.navigateToTrace({
          fromTraceId: "trace-first",
          fromViewMode: "trace",
          toTraceId: "trace-next",
          toTimestamp: 2_000,
        });
      });

      expect(useDrawerStore.getState().tenantId).toBeNull();
      expect(openDrawerMock).toHaveBeenLastCalledWith("traceV2Details", {
        traceId: "trace-next",
        t: "2000",
      });
    });
  });
});
