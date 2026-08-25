// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQuery } = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  api: { publicEnv: { useQuery } },
}));

import { usePublicEnv } from "../usePublicEnv";

describe("usePublicEnv", () => {
  beforeEach(() => {
    useQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("reads deployment configuration from the HTML shell without enabling a request", () => {
    const { result } = renderHook(() => usePublicEnv());

    expect(useQuery).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ enabled: false }),
    );
    expect(result.current.data).toMatchObject({
      BASE_HOST: "http://localhost:5560",
      NODE_ENV: "test",
      IS_SAAS: false,
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("waits only when caller-specific capabilities are requested", () => {
    useQuery.mockReturnValue({ data: undefined, isLoading: true });

    const { result } = renderHook(() => usePublicEnv({ includeCapabilities: true }));

    expect(useQuery).toHaveBeenCalledWith({}, expect.objectContaining({ enabled: true }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});
