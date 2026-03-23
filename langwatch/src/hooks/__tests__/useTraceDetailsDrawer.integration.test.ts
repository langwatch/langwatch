/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTraceDetailsDrawer } from "../useTraceDetailsDrawer";
import type { DrawerProps } from "../../components/drawerRegistry";

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
