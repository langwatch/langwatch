/**
 * @vitest-environment jsdom
 *
 * Regression tests for useSimulationRouter.
 *
 * Verifies that navigation functions construct URLs from the project slug
 * rather than from router.asPath, which would include query parameters
 * and produce malformed URLs.
 *
 * @see https://github.com/langwatch/langwatch/issues/2297
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockPush = vi.fn();
const mockReplace = vi.fn();

let mockQuery: Record<string, string> = {};

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    push: mockPush,
    replace: mockReplace,
    asPath: "/my-project/simulations?startDate=1234&endDate=5678",
  }),
}));

vi.mock("../../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { slug: "my-project" },
  }),
}));

import { useSimulationRouter } from "../useSimulationRouter";

describe("useSimulationRouter", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockQuery = {};
  });

  describe("goToSimulationSet", () => {
    describe("when query parameters are present in the URL", () => {
      it("navigates using project slug, not router.asPath", () => {
        const { result } = renderHook(() => useSimulationRouter());

        result.current.goToSimulationSet("test-set-123");

        expect(mockPush).toHaveBeenCalledWith(
          "/my-project/simulations/test-set-123"
        );
        expect(mockPush).toHaveBeenCalledTimes(1);
      });

      it("produces a URL without query parameters", () => {
        const { result } = renderHook(() => useSimulationRouter());

        result.current.goToSimulationSet("test-set-123");

        const calledUrl = mockPush.mock.calls[0]![0] as string;
        expect(calledUrl).not.toContain("?");
        expect(calledUrl).not.toContain("startDate");
        expect(calledUrl).not.toContain("endDate");
      });
    });
  });
});
