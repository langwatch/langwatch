/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDrawerRunCallbacks } from "../useDrawerRunCallbacks";

const mockOpenDrawer = vi.hoisted(() => vi.fn());

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
  }),
}));

describe("useDrawerRunCallbacks()", () => {
  describe("when onRunComplete is called", () => {
    it("opens the scenarioRunDetail drawer with the run id", () => {
      const { result } = renderHook(() => useDrawerRunCallbacks());

      result.current.onRunComplete({ scenarioRunId: "run-abc" });

      expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
        urlParams: { scenarioRunId: "run-abc" },
      });
    });
  });

  describe("when onRunFailed is called", () => {
    it("opens the scenarioRunDetail drawer with the run id", () => {
      const { result } = renderHook(() => useDrawerRunCallbacks());

      result.current.onRunFailed({ scenarioRunId: "run-xyz" });

      expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
        urlParams: { scenarioRunId: "run-xyz" },
      });
    });
  });
});
