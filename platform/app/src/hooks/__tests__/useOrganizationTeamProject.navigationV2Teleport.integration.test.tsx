/**
 * @vitest-environment jsdom
 *
 * The cross-organization project teleport (current org has no project,
 * another org does, so the hook pushes the user to that project) is
 * suppressed on devices in a navigation-v2 mode: the v2 org switch and
 * landing resolver own cross-org destinations. Legacy devices keep the
 * teleport bit-for-bit.
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

import { useNavigationModeStore } from "~/features/navigation/navigationModeStore";
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
  useNavigationModeStore.setState({ storedMode: "legacy" });
  mockOrganizationsQuery.mockReturnValue({
    data: [EMPTY_ORG, OTHER_ORG],
    isLoading: false,
    isFetched: true,
    isRefetching: false,
  });
  // Pin the ambient org to the empty one so the teleport branch is live.
  seedStorage("selectedOrganizationId", "org-empty");
});

afterEach(() => {
  cleanup();
});

function renderWithRedirects() {
  return renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: true,
      redirectToProjectOnboarding: true,
    }),
  );
}

describe("cross-organization project teleport", () => {
  describe("when the device is in legacy mode", () => {
    /** @scenario Legacy mode keeps sending the member to the other organization's project */
    it("pushes the user to the other organization's project", async () => {
      renderWithRedirects();

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith("/other-app");
      });
    });
  });

  describe("when the device is in a navigation-v2 mode", () => {
    /** @scenario A member kept in an empty organization stays put in the new modes */
    it("stays put", async () => {
      useNavigationModeStore.setState({ storedMode: "product-switcher" });
      renderWithRedirects();

      // Give the redirect effect a macrotask to fire if it were going to.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });
});
