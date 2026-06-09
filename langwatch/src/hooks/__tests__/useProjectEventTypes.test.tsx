/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useProjectEventTypes } from "../useProjectEventTypes";

const mockUseQuery = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    analytics: {
      dataForFilter: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

describe("useProjectEventTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty eventTypes when projectId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });

    const { result } = renderHook(() =>
      useProjectEventTypes({ projectId: undefined }),
    );

    expect(result.current.eventTypes).toEqual([]);
  });

  it("maps filter options into key/label event types", () => {
    mockUseQuery.mockReturnValue({
      data: {
        options: [
          { field: "thumbs_up", label: "thumbs_up", count: 12 },
          { field: "feedback", label: "feedback", count: 3 },
        ],
      },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useProjectEventTypes({ projectId: "project-123" }),
    );

    expect(result.current.eventTypes).toEqual([
      { key: "thumbs_up", label: "thumbs_up" },
      { key: "feedback", label: "feedback" },
    ]);
  });

  it("drops options with an empty field", () => {
    mockUseQuery.mockReturnValue({
      data: {
        options: [
          { field: "", label: "", count: 1 },
          { field: "thumbs_up", label: "thumbs_up", count: 2 },
        ],
      },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useProjectEventTypes({ projectId: "project-123" }),
    );

    expect(result.current.eventTypes).toEqual([
      { key: "thumbs_up", label: "thumbs_up" },
    ]);
  });

  it("queries the events.event_type filter field", () => {
    mockUseQuery.mockReturnValue({
      data: { options: [] },
      isLoading: false,
      error: null,
    });

    renderHook(() => useProjectEventTypes({ projectId: "project-123" }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-123",
        field: "events.event_type",
        startDate: expect.any(Number),
        endDate: expect.any(Number),
        filters: {},
      }),
      expect.objectContaining({
        enabled: true,
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
      }),
    );
  });

  it("disables the query when projectId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });

    renderHook(() => useProjectEventTypes({ projectId: undefined }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });

  it("disables the query when enabled is false even with a projectId", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });

    renderHook(() =>
      useProjectEventTypes({ projectId: "project-123", enabled: false }),
    );

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });
});
