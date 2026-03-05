/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { FEATURE_FLAG_CACHE_TTL_MS } from "../../server/featureFlag/constants";
import { useFeatureFlag } from "../useFeatureFlag";

vi.mock("../../utils/api", () => ({
  api: {
    featureFlag: {
      isEnabled: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { api } from "../../utils/api";

const mockUseQuery = vi.mocked(api.featureFlag.isEnabled.useQuery);

describe("useFeatureFlag()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when query is loading", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
    });

    it("returns isLoading true", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled"),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it("returns enabled false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled"),
      );

      expect(result.current.enabled).toBe(false);
    });
  });

  describe("when flag is disabled", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { enabled: false },
        isLoading: false,
      } as any);
    });

    it("returns enabled false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled"),
      );

      expect(result.current.enabled).toBe(false);
    });

    it("returns isLoading false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled"),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("when flag is enabled", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { enabled: true },
        isLoading: false,
      } as any);
    });

    it("returns enabled true", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled"),
      );

      expect(result.current.enabled).toBe(true);
    });

    it("returns isLoading false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled"),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("when options are provided", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { enabled: false },
        isLoading: false,
      } as any);
    });

    it("passes projectId and organizationId to query", () => {
      renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled", {
          projectId: "proj-123",
          organizationId: "org-456",
        }),
      );

      expect(mockUseQuery).toHaveBeenCalledWith(
        {
          flag: "release_ui_suites_enabled",
          projectId: "proj-123",
          organizationId: "org-456",
        },
        {
          staleTime: FEATURE_FLAG_CACHE_TTL_MS,
          refetchOnWindowFocus: false,
          enabled: true,
        },
      );
    });
  });

  describe("when options are not provided", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { enabled: false },
        isLoading: false,
      } as any);
    });

    it("passes undefined for optional params", () => {
      renderHook(() => useFeatureFlag("release_ui_suites_enabled"));

      expect(mockUseQuery).toHaveBeenCalledWith(
        {
          flag: "release_ui_suites_enabled",
          projectId: undefined,
          organizationId: undefined,
        },
        {
          staleTime: FEATURE_FLAG_CACHE_TTL_MS,
          refetchOnWindowFocus: false,
          enabled: true,
        },
      );
    });
  });

  describe("when enabled option is false", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
      } as any);
    });

    it("disables the query", () => {
      renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled", {
          projectId: undefined,
          enabled: false,
        }),
      );

      expect(mockUseQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          enabled: false,
        }),
      );
    });

    it("returns enabled false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled", {
          enabled: false,
        }),
      );

      expect(result.current.enabled).toBe(false);
    });

    it("returns isLoading false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_suites_enabled", {
          enabled: false,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });
});
