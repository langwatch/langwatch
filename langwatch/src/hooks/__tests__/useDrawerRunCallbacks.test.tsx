/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDrawerRunCallbacks } from "../useDrawerRunCallbacks";

const mockPush = vi.hoisted(() => vi.fn());

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { slug: "proj-slug" } }),
}));

describe("useDrawerRunCallbacks()", () => {
  describe("when onRunComplete is called with a batchRunId", () => {
    it("navigates to the simulations page with the batch highlighted", () => {
      mockPush.mockClear();
      const { result } = renderHook(() => useDrawerRunCallbacks());

      result.current.onRunComplete({
        scenarioRunId: "run-abc",
        batchRunId: "batch-123",
      });

      expect(mockPush).toHaveBeenCalledWith(
        "/proj-slug/simulations?pendingBatch=batch-123",
      );
    });
  });

  describe("when onRunFailed is called without a batchRunId", () => {
    it("navigates to the simulations page without query params", () => {
      mockPush.mockClear();
      const { result } = renderHook(() => useDrawerRunCallbacks());

      result.current.onRunFailed({ scenarioRunId: "run-xyz" });

      expect(mockPush).toHaveBeenCalledWith("/proj-slug/simulations");
    });
  });
});
