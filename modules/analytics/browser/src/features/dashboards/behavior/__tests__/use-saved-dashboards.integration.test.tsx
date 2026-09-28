/**
 * @vitest-environment jsdom
 * The "+" in the Dashboards sidebar must create a board only its creator
 * sees, matching the prototype's Mine grouping (#907).
 * @see specs/dashboards-v1.feature
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  rename: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
  utils: {
    dashboards: { getAll: { invalidate: vi.fn() } },
    licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
  },
  host: {
    project: () => ({ id: "project-1", slug: "acme", name: "Acme", hasFirstMessage: true }),
    navigate: vi.fn(),
    failed: vi.fn(),
  },
}));

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => mocks.utils,
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      create: { useMutation: () => mocks.create },
      rename: { useMutation: () => mocks.rename },
      delete: { useMutation: () => mocks.remove },
    },
  },
}));

vi.mock("../../../../model/analytics-host.ts", () => ({
  useAnalyticsHost: () => mocks.host,
}));

import { useSavedDashboards } from "../use-saved-dashboards.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a member clicks + in the Dashboards sidebar", () => {
  /** @scenario "AC10 Blank board matches the reference" */
  it("creates the board visible only to them", () => {
    const { result } = renderHook(() => useSavedDashboards());

    act(() => result.current.createBoard());

    expect(mocks.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", visibility: "only_me" }),
      expect.anything(),
    );
  });
});
