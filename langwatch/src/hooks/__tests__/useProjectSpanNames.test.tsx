/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useProjectSpanNames } from "../useProjectSpanNames";

// Mock the tRPC api
const mockUseQuery = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    traces: {
      getSampleTracesDataset: {
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

  it("extracts unique span names from traces", () => {
    const mockTraces = [
      {
        trace_id: "trace-1",
        spans: [
          { name: "openai/gpt-4", type: "llm" },
          { name: "my-custom-span", type: "span" },
        ],
      },
      {
        trace_id: "trace-2",
        spans: [
          { name: "openai/gpt-4", type: "llm" }, // Duplicate
          { name: "another-span", type: "span" },
        ],
      },
    ];

    mockUseQuery.mockReturnValue({
      data: mockTraces,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    // Should have unique span names
    expect(result.current.spanNames).toHaveLength(3);
    expect(result.current.spanNames.map((s) => s.key)).toContain("openai/gpt-4");
    expect(result.current.spanNames.map((s) => s.key)).toContain(
      "my-custom-span"
    );
    expect(result.current.spanNames.map((s) => s.key)).toContain("another-span");
  });

  it("returns empty spanNames when traces have no spans", () => {
    const mockTraces = [
      { trace_id: "trace-1", spans: [] },
      { trace_id: "trace-2" }, // No spans property
    ];

    mockUseQuery.mockReturnValue({
      data: mockTraces,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    expect(result.current.spanNames).toEqual([]);
  });

  it("calls getSampleTracesDataset with correct parameters", () => {
    mockUseQuery.mockReturnValue({
      data: [],
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

  it("extracts unique metadata keys from traces", () => {
    const mockTraces = [
      {
        trace_id: "trace-1",
        metadata: {
          user_id: "user-1",
          custom_field: "value",
        },
        spans: [],
      },
      {
        trace_id: "trace-2",
        metadata: {
          user_id: "user-2", // Same key as trace-1
          another_field: "value",
        },
        spans: [],
      },
    ];

    mockUseQuery.mockReturnValue({
      data: mockTraces,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useProjectSpanNames("project-123"));

    // Should have unique metadata keys plus reserved keys
    const keys = result.current.metadataKeys.map((k) => k.key);
    expect(keys).toContain("user_id");
    expect(keys).toContain("custom_field");
    expect(keys).toContain("another_field");
    // Reserved keys should also be present
    expect(keys).toContain("thread_id");
    expect(keys).toContain("labels");
  });
});
