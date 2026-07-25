/**
 * @vitest-environment jsdom
 *
 * A personal workspace must never become the ambient organization context by
 * ordering alone. It holds exactly one project, so it satisfies any "first
 * team that has a project" test, and everything scoped to the ambient project
 * — model provider credentials above all — would then be written into one
 * member's private space.
 *
 * These tests execute the real hook. Only its boundaries are stubbed: the
 * tRPC queries it reads, the router, the session, and localStorage. The
 * resolution chain under test (slug matching, remembered selection, team
 * fallback, project fallback) runs for real.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-not-ambient-context.feature
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrganizationsQuery, mockRouter, mockLocalStorage, idleQuery } =
  vi.hoisted(() => ({
    mockOrganizationsQuery: vi.fn(),
    idleQuery: () => ({
      data: undefined,
      isLoading: false,
      isFetched: true,
    }),
    mockRouter: {
      query: {} as Record<string, string>,
      route: "/settings/model-providers",
      pathname: "/settings/model-providers",
      asPath: "/settings/model-providers",
      push: vi.fn(),
      replace: vi.fn(),
    },
    mockLocalStorage: {
      selectedOrganizationId: "",
      selectedTeamId: "",
      selectedProjectSlug: "",
      lastVisitedHomeKind: "",
    } as Record<string, string>,
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

// The real `useLocalStorage`, backed by an object the tests can read back, so
// the write-through effect that persists the resolved selection is observable
// rather than mocked away.
vi.mock("usehooks-ts", () => ({
  useLocalStorage: (key: string, initial: string) => [
    mockLocalStorage[key] ?? initial,
    (value: string) => {
      mockLocalStorage[key] = value;
    },
  ],
}));

import {
  loadedOrganizationsQuery,
  PERSONAL_TEAM,
  SHARED_TEAM,
} from "~/test-utils/personalWorkspaceOrganization";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

function renderResolution() {
  return renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    }),
  );
}

describe("useOrganizationTeamProject personal-workspace resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.query = {};
    mockRouter.route = "/settings/model-providers";
    mockRouter.pathname = "/settings/model-providers";
    mockRouter.asPath = "/settings/model-providers";
    for (const key of Object.keys(mockLocalStorage)) {
      mockLocalStorage[key] = "";
    }
    mockOrganizationsQuery.mockReturnValue(
      loadedOrganizationsQuery([PERSONAL_TEAM, SHARED_TEAM]),
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an organization-scoped page and nothing selected yet", () => {
    /** @scenario The personal workspace sorts first but does not win */
    it("resolves the shared team even though the personal one is listed first", () => {
      const { result } = renderResolution();

      expect(result.current.team?.id).toBe("team-shared");
    });

    /** @scenario Organization-scoped credentials are filed against the organization's project */
    it("resolves the organization's project, which is what settings writes against", () => {
      const { result } = renderResolution();

      expect(result.current.project?.id).toBe("proj-app");
      expect(result.current.projectId).toBe("proj-app");
    });
  });

  describe("given the shared team has no project yet", () => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        loadedOrganizationsQuery([
          PERSONAL_TEAM,
          { ...SHARED_TEAM, projects: [] },
        ]),
      );
    });

    /** @scenario A shared team without a project still outranks a personal one */
    it("resolves the shared team rather than the personal one that has a project", () => {
      const { result } = renderResolution();

      expect(result.current.team?.id).toBe("team-shared");
    });

    /** @scenario A shared team without a project still outranks a personal one */
    it("leaves the page without a project, so it can say a project comes first", () => {
      const { result } = renderResolution();

      expect(result.current.project).toBeUndefined();
    });
  });

  describe("given the personal project is named in the address bar", () => {
    beforeEach(() => {
      mockRouter.query = { project: "personal-jane-abc123" };
      mockRouter.route = "/[project]/traces";
      mockRouter.pathname = "/[project]/traces";
      mockRouter.asPath = "/personal-jane-abc123/traces";
    });

    /** @scenario Opening the personal project by its own address */
    it("resolves the personal project", () => {
      const { result } = renderResolution();

      expect(result.current.project?.id).toBe("proj-personal");
    });

    /** @scenario Opening the personal project by its own address */
    it("resolves the personal team, which the personal chrome keys off", () => {
      const { result } = renderResolution();

      expect(result.current.team?.id).toBe("team-personal");
      expect(result.current.team?.isPersonal).toBe(true);
    });
  });

  describe("given the personal project is only the remembered selection", () => {
    beforeEach(() => {
      mockLocalStorage.selectedOrganizationId = "org-acme";
      mockLocalStorage.selectedTeamId = "team-personal";
      mockLocalStorage.selectedProjectSlug = "personal-jane-abc123";
    });

    /** @scenario Leaving the personal project releases it */
    it("resolves the organization's project instead", () => {
      const { result } = renderResolution();

      expect(result.current.project?.id).toBe("proj-app");
    });

    /** @scenario Leaving the personal project releases it */
    it("resolves the shared team instead", () => {
      const { result } = renderResolution();

      expect(result.current.team?.id).toBe("team-shared");
    });

    /** @scenario The remembered selection heals after one organization-scoped page */
    it("re-persists the shared project over the stale personal one", () => {
      renderResolution();

      expect(mockLocalStorage.selectedProjectSlug).toBe("acme-app");
      expect(mockLocalStorage.selectedTeamId).toBe("team-shared");
    });
  });

  describe("given the organization's only team is the personal one", () => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        loadedOrganizationsQuery([PERSONAL_TEAM]),
      );
    });

    /** @scenario The personal workspace is the only one there is */
    it("resolves the personal workspace rather than leaving the app contextless", () => {
      const { result } = renderResolution();

      expect(result.current.team?.id).toBe("team-personal");
      expect(result.current.project?.id).toBe("proj-personal");
    });

    /** @scenario A remembered personal team is not held against the only organization */
    it("keeps resolving it when it is also the remembered selection", () => {
      mockLocalStorage.selectedOrganizationId = "org-acme";
      mockLocalStorage.selectedTeamId = "team-personal";
      mockLocalStorage.selectedProjectSlug = "personal-jane-abc123";

      const { result } = renderResolution();

      expect(result.current.team?.id).toBe("team-personal");
      expect(result.current.project?.id).toBe("proj-personal");
    });
  });

  describe("given a shared project is named in the address bar", () => {
    beforeEach(() => {
      mockRouter.query = { project: "acme-app" };
      mockRouter.route = "/[project]/messages";
      mockRouter.pathname = "/[project]/messages";
      mockRouter.asPath = "/acme-app/messages";
    });

    /** Guards the ordinary path: the change must not disturb it. */
    it("resolves that project and its team", () => {
      const { result } = renderResolution();

      expect(result.current.project?.id).toBe("proj-app");
      expect(result.current.team?.id).toBe("team-shared");
    });
  });
});
