/**
 * @vitest-environment jsdom
 * Creating a board sends no visibility (every board is the project's), and
 * the list carries each board's star and last change.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updated: new Date("2026-01-02"),
  create: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  rename: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
  utils: {
    dashboards: {
      getAll: { invalidate: vi.fn() },
      listStarred: { invalidate: vi.fn() },
    },
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
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "board-1",
              name: "Weekly",
              description: null,
              createdById: "user-1",
              isStarred: true,
              updatedAt: mocks.updated,
              order: 0,
              _count: { graphs: 2 },
            },
          ],
        }),
      },
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

describe("given a member creates a board", () => {
  /** @scenario "AC10 Blank board matches the reference" */
  it("sends the project and a numbered name, and no visibility", () => {
    const { result } = renderHook(() => useSavedDashboards());

    act(() => result.current.createBoard());

    expect(mocks.create.mutate).toHaveBeenCalledWith(
      { projectId: "project-1", name: "Untitled dashboard 2" },
      expect.anything(),
    );
  });
});

describe("given the project has boards", () => {
  /** @scenario "AC161b Your dashboards: My dashboard first, then the team's unstarred boards by name" */
  it("lists each with its star and last change", () => {
    const { result } = renderHook(() => useSavedDashboards());

    expect(result.current.boards).toEqual([
      {
        id: "board-1",
        name: "Weekly",
        description: null,
        createdById: "user-1",
        isStarred: true,
        updatedAt: mocks.updated,
      },
    ]);
  });
});
