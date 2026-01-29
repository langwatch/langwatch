/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { FEATURE_FLAG_CACHE_TTL_MS } from "../../server/featureFlag/config";
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

describe("useFeatureFlag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns loading state initially", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    const { result } = renderHook(() =>
      useFeatureFlag("release_ui_simulations_menu_enabled"),
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.enabled).toBe(false);
  });

  it("returns enabled false when flag is disabled", () => {
    mockUseQuery.mockReturnValue({
      data: { enabled: false },
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFeatureFlag("release_ui_simulations_menu_enabled"),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.enabled).toBe(false);
  });

  it("returns enabled true when flag is enabled", () => {
    mockUseQuery.mockReturnValue({
      data: { enabled: true },
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFeatureFlag("release_ui_simulations_menu_enabled"),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.enabled).toBe(true);
  });

  it("passes flag and options to useQuery", () => {
    mockUseQuery.mockReturnValue({
      data: { enabled: false },
      isLoading: false,
    } as any);

    renderHook(() =>
      useFeatureFlag("release_ui_simulations_menu_enabled", {
        projectId: "proj-123",
        organizationId: "org-456",
      }),
    );

    expect(mockUseQuery).toHaveBeenCalledWith(
      {
        flag: "release_ui_simulations_menu_enabled",
        targetProjectId: "proj-123",
        targetOrganizationId: "org-456",
      },
      {
        staleTime: FEATURE_FLAG_CACHE_TTL_MS,
        refetchOnWindowFocus: false,
        enabled: true,
      },
    );
  });

  it("passes undefined for optional params when not provided", () => {
    mockUseQuery.mockReturnValue({
      data: { enabled: false },
      isLoading: false,
    } as any);

    renderHook(() => useFeatureFlag("release_ui_simulations_menu_enabled"));

    expect(mockUseQuery).toHaveBeenCalledWith(
      {
        flag: "release_ui_simulations_menu_enabled",
        targetProjectId: undefined,
        targetOrganizationId: undefined,
      },
      {
        staleTime: FEATURE_FLAG_CACHE_TTL_MS,
        refetchOnWindowFocus: false,
        enabled: true,
      },
    );
  });

  it("disables query when enabled option is false", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFeatureFlag("release_ui_simulations_menu_enabled", {
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
    expect(result.current.enabled).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});
