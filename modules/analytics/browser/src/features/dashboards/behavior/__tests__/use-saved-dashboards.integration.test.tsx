/**
 * @vitest-environment jsdom
 * Creating a board sends no scope (the server starts it at Project), and the list carries
 * each board's star, scope and last change, the organization's boards apart from the project's.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listInputs: [] as unknown[],
  own: {
    id: "board-1",
    projectId: "project-1",
    name: "Weekly",
    description: null,
    createdById: "user-1",
    scope: "PROJECT",
    organizationId: null,
    ownerProject: null,
    isStarred: true,
    updatedAt: new Date("2026-01-02"),
  },
  shared: {
    id: "board-9",
    projectId: "project-2",
    name: "Quality",
    description: null,
    createdById: "user-9",
    scope: "ORGANIZATION",
    organizationId: "org-1",
    ownerProject: { id: "project-2", name: "Checkout", slug: "checkout" },
    isStarred: false,
    updatedAt: new Date("2026-01-02"),
  },
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
        useQuery: (input: unknown) => {
          mocks.listInputs.push(input);
          return {
            data: [
              { ...mocks.own, order: 0, _count: { graphs: 2 } },
              { ...mocks.shared, order: 0, _count: { graphs: 1 } },
            ],
          };
        },
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
  it("sends the project and a numbered name, and no scope", () => {
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
  it("lists each with its star, scope and last change", () => {
    const { result } = renderHook(() => useSavedDashboards());

    expect(result.current.boards).toEqual([mocks.own]);
  });

  /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
  it("asks for the organization's boards too, and keeps them apart from the project's own", () => {
    const { result } = renderHook(() => useSavedDashboards());

    expect({
      asked: mocks.listInputs.at(-1),
      organizationBoards: result.current.organizationBoards,
    }).toEqual({
      asked: { projectId: "project-1", includeOrganization: true },
      organizationBoards: [mocks.shared],
    });
  });
});
