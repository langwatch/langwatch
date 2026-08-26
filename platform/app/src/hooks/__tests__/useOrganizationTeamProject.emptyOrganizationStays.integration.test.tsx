/**
 * @vitest-environment jsdom
 *
 * A member whose current organization has no project is never teleported
 * into another organization's project. The v2 org switch and the landing
 * resolver own cross-organization destinations.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrganizationsQuery, mockRouter, idleQuery } = vi.hoisted(() => ({
  mockOrganizationsQuery: vi.fn(),
  idleQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetched: true,
  }),
  mockRouter: {
    query: {} as Record<string, string>,
    route: "/some-page",
    pathname: "/some-page",
    asPath: "/some-page",
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: { getAll: { useQuery: mockOrganizationsQuery } },
    sharedTrace: { get: { useQuery: idleQuery } },
    publicEnv: { useQuery: idleQuery },
    modelProvider: { getAllForProject: { useQuery: idleQuery } },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-jane" } },
    status: "authenticated",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

const EMPTY_ORG = {
  id: "org-empty",
  name: "Empty Org",
  slug: "empty-org",
  primaryIntent: null,
  members: [{ role: "ADMIN" }],
  teams: [
    {
      id: "team-empty",
      name: "Empty Team",
      slug: "empty-team",
      isPersonal: false,
      ownerUserId: null,
      members: [{ role: "ADMIN" }],
      projects: [],
    },
  ],
};

const OTHER_ORG = {
  id: "org-other",
  name: "Other Org",
  slug: "other-org",
  primaryIntent: null,
  members: [{ role: "ADMIN" }],
  teams: [
    {
      id: "team-other",
      name: "Other Team",
      slug: "other-team",
      isPersonal: false,
      ownerUserId: null,
      members: [{ role: "ADMIN" }],
      projects: [{ id: "proj-other", name: "Other App", slug: "other-app" }],
    },
  ],
};

function seedStorage(key: string, value: string) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

beforeEach(() => {
  window.localStorage.clear();
  mockRouter.push.mockClear();
  mockOrganizationsQuery.mockReturnValue({
    data: [EMPTY_ORG, OTHER_ORG],
    isLoading: false,
    isFetched: true,
    isRefetching: false,
  });
  // Pin the ambient org to the empty one.
  seedStorage("selectedOrganizationId", "org-empty");
});

afterEach(() => {
  cleanup();
});

describe("useOrganizationTeamProject", () => {
  /** @scenario A member kept in an empty organization stays put */
  it("does not push a member to another organization's project", async () => {
    const { result } = renderHook(() =>
      useOrganizationTeamProject({
        redirectToOnboarding: true,
        redirectToProjectOnboarding: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.organization?.id).toBe("org-empty");
    });
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
