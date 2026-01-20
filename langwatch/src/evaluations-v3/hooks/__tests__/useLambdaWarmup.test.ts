/**
 * @vitest-environment jsdom
 *
 * Tests for the Lambda warmup hook.
 * Verifies that the hook calls the backend tRPC endpoint to warm up AWS Lambda instances.
 */

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the mutation
const mockMutate = vi.fn();
vi.mock("../../../utils/api", () => ({
  api: {
    evaluations: {
      warmupLambda: {
        useMutation: () => ({
          mutate: mockMutate,
          isPending: false,
        }),
      },
    },
  },
}));

// Mock project
let mockProject: { id: string; name: string } | null = {
  id: "test-project-id",
  name: "Test Project",
};
vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: mockProject }),
}));

// Mock store state
let mockConcurrency = 10;
vi.mock("../useEvaluationsV3Store", () => ({
  useEvaluationsV3Store: (
    selector: (state: { ui: { concurrency: number } }) => unknown
  ) => selector({ ui: { concurrency: mockConcurrency } }),
}));

// Import hook after mocks
import { useLambdaWarmup } from "../useLambdaWarmup";

describe("useLambdaWarmup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockConcurrency = 10;
    mockProject = { id: "test-project-id", name: "Test Project" };

    // Mock document.hidden
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sends initial warmup request on mount", () => {
    renderHook(() => useLambdaWarmup());

    expect(mockMutate).toHaveBeenCalledWith({
      projectId: "test-project-id",
      count: 5, // half of 10
    });
  });

  it("sends half of concurrency as count (rounded down)", () => {
    mockConcurrency = 10; // Should send count: 5
    renderHook(() => useLambdaWarmup());

    expect(mockMutate).toHaveBeenCalledWith({
      projectId: "test-project-id",
      count: 5,
    });
  });

  it("sends minimum of 1 even with low concurrency", () => {
    mockConcurrency = 1; // 1 / 2 = 0.5, floor = 0, but min is 1
    renderHook(() => useLambdaWarmup());

    expect(mockMutate).toHaveBeenCalledWith({
      projectId: "test-project-id",
      count: 1,
    });
  });

  it("sends correct count for different concurrency values", () => {
    // Test with concurrency = 24 -> count should be 12
    mockConcurrency = 24;
    const { unmount } = renderHook(() => useLambdaWarmup());

    expect(mockMutate).toHaveBeenCalledWith({
      projectId: "test-project-id",
      count: 12,
    });

    unmount();
    vi.clearAllMocks();

    // Test with concurrency = 3 -> count should be 1 (floor(3/2) = 1)
    mockConcurrency = 3;
    renderHook(() => useLambdaWarmup());

    expect(mockMutate).toHaveBeenCalledWith({
      projectId: "test-project-id",
      count: 1,
    });
  });

  it("sends periodic warmup requests every 30 seconds", () => {
    renderHook(() => useLambdaWarmup());

    // Initial request
    expect(mockMutate).toHaveBeenCalledTimes(1);

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30_000);

    // Should have sent another request
    expect(mockMutate).toHaveBeenCalledTimes(2);

    // Advance another 30 seconds
    vi.advanceTimersByTime(30_000);

    expect(mockMutate).toHaveBeenCalledTimes(3);
  });

  it("stops sending requests when page becomes hidden", () => {
    renderHook(() => useLambdaWarmup());

    // Initial request
    expect(mockMutate).toHaveBeenCalledTimes(1);

    // Simulate page becoming hidden
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance time significantly
    vi.advanceTimersByTime(60_000);

    // Should not have sent more requests while hidden
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("resumes sending requests when page becomes visible again", () => {
    renderHook(() => useLambdaWarmup());

    // Initial request
    expect(mockMutate).toHaveBeenCalledTimes(1);

    // Simulate page becoming hidden
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Simulate page becoming visible again
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Should have sent immediate warmup request when becoming visible
    expect(mockMutate).toHaveBeenCalledTimes(2);

    // And interval should be working again
    vi.advanceTimersByTime(30_000);
    expect(mockMutate).toHaveBeenCalledTimes(3);
  });

  it("cleans up interval on unmount", () => {
    const { unmount } = renderHook(() => useLambdaWarmup());

    // Initial request
    expect(mockMutate).toHaveBeenCalledTimes(1);

    unmount();

    // Advance time
    vi.advanceTimersByTime(60_000);

    // Should not have sent more requests after unmount
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("does not send requests when project is null", () => {
    mockProject = null;
    renderHook(() => useLambdaWarmup());

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("returns null (no UI rendering)", () => {
    const { result } = renderHook(() => useLambdaWarmup());
    expect(result.current).toBeNull();
  });
});
