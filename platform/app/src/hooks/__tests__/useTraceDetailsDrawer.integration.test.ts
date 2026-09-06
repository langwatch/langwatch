/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawerProps } from "../../components/drawerRegistry";
import { useTraceDetailsDrawer } from "../useTraceDetailsDrawer";

// The hook is a thin convenience wrapper: it always delegates to
// `openDrawer("traceV2Details", …)`. The EXTERNAL-user restriction lives
// centrally in `CurrentDrawer` and is covered by its own tests — here we only
// pin the delegation contract.
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
    it("delegates to openDrawer with traceV2Details and props", () => {
      const traceProps: Partial<DrawerProps<"traceV2Details">> = {
        traceId: "trace-123",
      };
      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer(traceProps);
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceV2Details", traceProps);
    });
  });

  describe("when called without props", () => {
    it("delegates to openDrawer with traceV2Details and undefined", () => {
      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceV2Details", undefined);
    });
  });
});
