/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLatestPromptVersion } from "../useLatestPromptVersion";

// Mock the dependencies
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123" },
  }),
}));

const mockUseQuery = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    prompts: {
      getByIdOrHandle: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

describe("useLatestPromptVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when configId is not provided", () => {
    it("does not fetch and returns undefined values", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isFetching: false,
      });

      const { result } = renderHook(() =>
        useLatestPromptVersion({ configId: undefined, currentVersion: 1 }),
      );

      expect(result.current.latestVersion).toBeUndefined();
      expect(result.current.isOutdated).toBe(false);
      expect(result.current.nextVersion).toBeUndefined();
    });
  });

  describe("when current version matches latest", () => {
    it("returns isOutdated as false", () => {
      mockUseQuery.mockReturnValue({
        data: { version: 3 },
        isLoading: false,
        isFetching: false,
      });

      const { result } = renderHook(() =>
        useLatestPromptVersion({ configId: "config-123", currentVersion: 3 }),
      );

      expect(result.current.currentVersion).toBe(3);
      expect(result.current.latestVersion).toBe(3);
      expect(result.current.isOutdated).toBe(false);
      expect(result.current.nextVersion).toBe(4);
    });
  });

  describe("when current version is behind latest", () => {
    it("returns isOutdated as true", () => {
      mockUseQuery.mockReturnValue({
        data: { version: 5 },
        isLoading: false,
        isFetching: false,
      });

      const { result } = renderHook(() =>
        useLatestPromptVersion({ configId: "config-123", currentVersion: 3 }),
      );

      expect(result.current.currentVersion).toBe(3);
      expect(result.current.latestVersion).toBe(5);
      expect(result.current.isOutdated).toBe(true);
      expect(result.current.nextVersion).toBe(6);
    });
  });

  describe("when still loading", () => {
    it("returns isOutdated as false while loading", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isFetching: false,
      });

      const { result } = renderHook(() =>
        useLatestPromptVersion({ configId: "config-123", currentVersion: 3 }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isOutdated).toBe(false);
    });
  });

  describe("when fetching (refetch)", () => {
    it("returns isOutdated as false while fetching", () => {
      mockUseQuery.mockReturnValue({
        data: { version: 5 },
        isLoading: false,
        isFetching: true,
      });

      const { result } = renderHook(() =>
        useLatestPromptVersion({ configId: "config-123", currentVersion: 3 }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isOutdated).toBe(false);
    });
  });
});

