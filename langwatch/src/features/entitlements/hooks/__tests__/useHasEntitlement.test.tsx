/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHasEntitlement, useCurrentPlan } from "../useHasEntitlement";

// Mock the api module
vi.mock("../../../../utils/api", () => ({
  api: {
    publicEnv: {
      useQuery: vi.fn(),
    },
  },
}));

import { api } from "../../../../utils/api";

describe("useHasEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true for entitled feature with enterprise plan", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: { SELF_HOSTED_PLAN: "self-hosted:enterprise" },
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

    expect(result.current).toBe(true);
  });

  it("returns false for non-entitled feature with OSS plan", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

    expect(result.current).toBe(false);
  });

  it("returns true while loading to avoid flash of locked UI", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

    expect(result.current).toBe(true);
  });

  it("returns true for base entitlement with OSS plan", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useHasEntitlement("sso-google"));

    expect(result.current).toBe(true);
  });

  it("defaults to OSS plan when SELF_HOSTED_PLAN is not set", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: {},
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

    // OSS plan should not have custom-rbac
    expect(result.current).toBe(false);
  });
});

describe("useCurrentPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current plan when loaded", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: { SELF_HOSTED_PLAN: "self-hosted:enterprise" },
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useCurrentPlan());

    expect(result.current).toBe("self-hosted:enterprise");
  });

  it("returns undefined while loading", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useCurrentPlan());

    expect(result.current).toBeUndefined();
  });

  it("defaults to OSS plan when SELF_HOSTED_PLAN is not set", () => {
    vi.mocked(api.publicEnv.useQuery).mockReturnValue({
      data: {},
    } as ReturnType<typeof api.publicEnv.useQuery>);

    const { result } = renderHook(() => useCurrentPlan());

    expect(result.current).toBe("self-hosted:oss");
  });
});
