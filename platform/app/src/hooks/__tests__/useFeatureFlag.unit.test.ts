/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { CLIENT_FLAG_STALE_TIME_MS, useFeatureFlag } from "../useFeatureFlag";

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
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it("returns enabled false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
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
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
      );

      expect(result.current.enabled).toBe(false);
    });

    it("returns isLoading false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
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
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
      );

      expect(result.current.enabled).toBe(true);
    });

    it("returns isLoading false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
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
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: "proj-123",
          organizationId: "org-456",
        }),
      );

      expect(mockUseQuery).toHaveBeenCalledWith(
        {
          flag: "release_ui_ai_gateway_menu_enabled",
          projectId: "proj-123",
          organizationId: "org-456",
        },
        {
          staleTime: CLIENT_FLAG_STALE_TIME_MS,
          refetchOnWindowFocus: false,
          enabled: true,
          trpc: { context: { skipBatch: true } },
        },
      );
    });
  });

  describe("when neither scope targets the read", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { enabled: false },
        isLoading: false,
      } as any);
    });

    it("sends null for both scopes", () => {
      renderHook(() =>
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        }),
      );

      expect(mockUseQuery).toHaveBeenCalledWith(
        {
          flag: "release_ui_ai_gateway_menu_enabled",
          projectId: null,
          organizationId: null,
        },
        {
          staleTime: CLIENT_FLAG_STALE_TIME_MS,
          refetchOnWindowFocus: false,
          enabled: true,
          trpc: { context: { skipBatch: true } },
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
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: undefined,
          organizationId: undefined,
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
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: undefined,
          organizationId: undefined,
          enabled: false,
        }),
      );

      expect(result.current.enabled).toBe(false);
    });

    it("returns isLoading false", () => {
      const { result } = renderHook(() =>
        useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
          projectId: undefined,
          organizationId: undefined,
          enabled: false,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });
});
