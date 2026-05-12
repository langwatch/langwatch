/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useProjectSpanNames } from "../useProjectSpanNames";

// Mock the tRPC api
const mockUseQuery = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    traces: {
      getFieldNames: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

describe("useProjectSpanNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty spanNames and metadataKeys when projectId is undefined", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames(undefined));

    expect(result.current.spanNames).toEqual([]);
    expect(result.current.metadataKeys).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns loading state while fetching", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.spanNames).toEqual([]);
  });

  it("returns span names from the endpoint response", () => {
    mockUseQuery.mockReturnValue({
      data: {
        spanNames: [
          { key: "openai/gpt-4", label: "openai/gpt-4" },
          { key: "my-custom-span", label: "my-custom-span" },
          { key: "another-span", label: "another-span" },
        ],
        metadataKeys: [],
      },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    expect(result.current.spanNames).toHaveLength(3);
    expect(result.current.spanNames.map((s) => s.key)).toContain(
      "openai/gpt-4"
    );
    expect(result.current.spanNames.map((s) => s.key)).toContain(
      "my-custom-span"
    );
    expect(result.current.spanNames.map((s) => s.key)).toContain(
      "another-span"
    );
  });

  it("returns empty spanNames when no data", () => {
    mockUseQuery.mockReturnValue({
      data: { spanNames: [], metadataKeys: [] },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    expect(result.current.spanNames).toEqual([]);
  });

  it("calls getFieldNames with correct parameters", () => {
    mockUseQuery.mockReturnValue({
      data: { spanNames: [], metadataKeys: [] },
      isLoading: false,
      error: null,
    });

    renderHook(() => useProjectSpanNames("project-123"));

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-123",
        startDate: expect.any(Number),
        endDate: expect.any(Number),
      }),
      expect.objectContaining({
        enabled: true,
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
      })
    );
  });

  it("disables query when projectId is undefined", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    renderHook(() => useProjectSpanNames(undefined));

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        enabled: false,
      })
    );
  });

  it("handles API errors", () => {
    const mockError = new Error("API Error");
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: mockError,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    expect(result.current.error).toBe(mockError);
    expect(result.current.spanNames).toEqual([]);
    expect(result.current.metadataKeys).toEqual([]);
  });

  it("merges ES metadata keys with reserved keys", () => {
    mockUseQuery.mockReturnValue({
      data: {
        spanNames: [],
        metadataKeys: [
          { key: "user_id", label: "user_id" },
          { key: "custom_field", label: "custom_field" },
        ],
      },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    const keys = result.current.metadataKeys.map((k) => k.key);
    expect(keys).toContain("user_id");
    expect(keys).toContain("custom_field");
    // Reserved keys should also be present
    expect(keys).toContain("thread_id");
    expect(keys).toContain("labels");
  });

  it("excludes 'custom' and 'all_keys' from metadata keys", () => {
    mockUseQuery.mockReturnValue({
      data: {
        spanNames: [],
        metadataKeys: [
          { key: "custom", label: "custom" },
          { key: "all_keys", label: "all_keys" },
          { key: "user_id", label: "user_id" },
        ],
      },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    const keys = result.current.metadataKeys.map((k) => k.key);
    expect(keys).not.toContain("custom");
    expect(keys).not.toContain("all_keys");
    expect(keys).toContain("user_id");
  });
});
