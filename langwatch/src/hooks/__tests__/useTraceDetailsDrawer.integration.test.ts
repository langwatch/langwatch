/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawerProps } from "../../components/drawerRegistry";
import { useTraceDetailsDrawer } from "../useTraceDetailsDrawer";

// The hook is a thin convenience wrapper: it always delegates to
// `openDrawer("traceDetails", …)`. The cross-cutting concerns (EXTERNAL-user
// restriction, traces-v2 opt-in routing) live centrally in `CurrentDrawer`
// and `openDrawer` and are covered by their own tests — here we only pin the
// delegation contract.
vi.mock("../useDrawer", () => ({
  useDrawer: vi.fn(),
}));

import { useDrawer } from "../useDrawer";

const mockUseDrawer = vi.mocked(useDrawer);
const mockOpenDrawer = vi.fn();

describe("useTraceDetailsDrawer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDrawer.mockReturnValue({
      openDrawer: mockOpenDrawer,
    } as unknown as ReturnType<typeof useDrawer>);
  });

  describe("when called with props", () => {
    it("delegates to openDrawer with traceDetails and props", () => {
      const traceProps: Partial<DrawerProps<"traceDetails">> = {
        traceId: "trace-123",
      };
      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer(traceProps);
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", traceProps);
    });
  });

  describe("when called without props", () => {
    it("delegates to openDrawer with traceDetails and undefined", () => {
      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", undefined);
    });
  });
});
