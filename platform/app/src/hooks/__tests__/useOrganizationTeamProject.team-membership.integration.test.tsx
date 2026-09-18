/**
 * @vitest-environment jsdom
 *
 * The teams list the app resolves against carries the whole organization, not
 * just the caller's corner of it, so an ambient pick expressed purely as "the
 * first team shaped like X" hands a member a team they are not on as soon as
 * an organization has more than one. Every page without a project in its
 * address bar reads that pick, `/settings/*` included, and the chrome refuses
 * a page outright when the resolved team holds no membership for the caller:
 * "You are not part of any team in this organization".
 *
 * These tests execute the real hook. Only its boundaries are stubbed: the
 * tRPC queries it reads, the router, the session, and localStorage. The
 * resolution chain under test runs for real.
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
      route: "/settings/api-keys",
      pathname: "/settings/api-keys",
      asPath: "/settings/api-keys",
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
    data: { user: { id: MEMBER_ID } },
    status: "authenticated",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("usehooks-ts", () => ({
  useLocalStorage: (key: string, initial: string) => [
    mockLocalStorage[key] ?? initial,
    (value: string) => {
      mockLocalStorage[key] = value;
    },
  ],
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

const MEMBER_ID = "user-member";

/** The team the member is NOT on. Listed first, so ordering alone elects it. */
const OTHER_TEAM = {
  id: "team-platform",
  name: "ACME Platform",
  slug: "acme-platform",
  isPersonal: false,
  ownerUserId: null,
  members: [] as { userId: string; role: string }[],
  projects: [
    { id: "proj-platform", name: "Platform App", slug: "platform-app" },
  ],
};

/** The owning team, where the member holds a real membership row. */
const OWNING_TEAM = {
  id: "team-data",
  name: "ACME Data",
  slug: "acme-data",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: MEMBER_ID, role: "MEMBER" }],
  projects: [{ id: "proj-data", name: "Data App", slug: "data-app" }],
};

function organizationWith({
  teams,
  organizationRole = "MEMBER",
}: {
  teams: unknown[];
  organizationRole?: string;
}) {
  return {
    data: [
      {
        id: "org-acme",
        name: "ACME",
        slug: "acme",
        primaryIntent: null,
        // `organization.getAll` narrows the members to the caller's own row.
        members: [{ role: organizationRole }],
        teams,
      },
    ],
    isLoading: false,
    isFetched: true,
    isRefetching: false,
  };
}

function renderResolution() {
  return renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    }),
  );
}

/**
 * The predicate `DashboardLayout` gates every page body on, restated here
 * rather than imported. What the resolution has to produce is not merely "a
 * team" but one the caller can be shown a page for, and an independent
 * statement of that is what makes the assertion mean anything: calling the
 * hook's own exported predicate would let the two drift together and still
 * agree, which is exactly the failure this covers.
 *
 * Both inputs come from the hook under test, never from a literal in the
 * test body. A literal role would make the admin assertions pass on their
 * own, whatever role the hook resolved.
 */
function chromeWouldRefuse({
  team,
  organizationRole,
}: {
  team: { members?: { userId: string }[] } | undefined;
  organizationRole: string | undefined;
}) {
  // The page body renders for an organization admin on the role alone,
  // whatever team rows they hold.
  if (organizationRole === "ADMIN") return false;
  return !(
    team?.members?.some((member) => member.userId === MEMBER_ID) ?? false
  );
}

describe("useOrganizationTeamProject team-membership resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.query = {};
    mockRouter.route = "/settings/api-keys";
    mockRouter.pathname = "/settings/api-keys";
    mockRouter.asPath = "/settings/api-keys";
    for (const key of Object.keys(mockLocalStorage)) {
      mockLocalStorage[key] = "";
    }
    mockOrganizationsQuery.mockReturnValue(
      organizationWith({ teams: [OTHER_TEAM, OWNING_TEAM] }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a member of one team in an organization that has several", () => {
    describe("when they open a settings page with nothing selected yet", () => {
      /** @scenario A member resolves the team they are on, not the first one listed */
      it("resolves the team the member is on, not the one that sorts first", () => {
        const { result } = renderResolution();

        expect(result.current.team?.id).toBe("team-data");
        expect(
          chromeWouldRefuse({
            team: result.current.team,
            organizationRole: result.current.organizationRole,
          }),
        ).toBe(false);
      });

      /** @scenario The ambient project belongs to the team the member is on */
      it("resolves that team's project, which is what settings writes against", () => {
        const { result } = renderResolution();

        expect(result.current.project?.slug).toBe("data-app");
      });
    });

    describe("when a selection remembered from another context names a team they are not on", () => {
      /** @scenario A remembered team the member is not on does not win */
      it("ignores the remembered team and resolves the one they hold", () => {
        mockLocalStorage.selectedTeamId = "team-platform";
        mockLocalStorage.selectedProjectSlug = "platform-app";

        const { result } = renderResolution();

        expect(result.current.team?.id).toBe("team-data");
        expect(result.current.project?.slug).toBe("data-app");
        expect(
          chromeWouldRefuse({
            team: result.current.team,
            organizationRole: result.current.organizationRole,
          }),
        ).toBe(false);
      });

      /** @scenario The remembered selection heals to the team the member is on */
      it("re-persists the resolved selection so the stale one heals", () => {
        mockLocalStorage.selectedTeamId = "team-platform";
        mockLocalStorage.selectedProjectSlug = "platform-app";

        renderResolution();

        expect(mockLocalStorage.selectedTeamId).toBe("team-data");
        expect(mockLocalStorage.selectedProjectSlug).toBe("data-app");
      });
    });
  });

  describe("given an admin of the organization, on one of its teams", () => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        organizationWith({
          teams: [OTHER_TEAM, OWNING_TEAM],
          organizationRole: "ADMIN",
        }),
      );
    });

    describe("when they open a settings page after working in another team's project", () => {
      /** @scenario "The admin's picked project survives a page that names no project" */
      it("keeps the project they picked, and its team", () => {
        mockLocalStorage.selectedTeamId = "team-platform";
        mockLocalStorage.selectedProjectSlug = "platform-app";

        const { result } = renderResolution();

        expect(result.current.project?.slug).toBe("platform-app");
        expect(result.current.team?.id).toBe("team-platform");
        expect(result.current.organizationRole).toBe("ADMIN");
        expect(
          chromeWouldRefuse({
            team: result.current.team,
            organizationRole: result.current.organizationRole,
          }),
        ).toBe(false);
      });

      /** @scenario "The admin's remembered team survives" */
      it("keeps the remembered team when only the team is remembered", () => {
        mockLocalStorage.selectedTeamId = "team-platform";

        const { result } = renderResolution();

        expect(result.current.team?.id).toBe("team-platform");
      });
    });
  });

  describe("given someone who belongs to no team in the organization", () => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        organizationWith({
          teams: [OTHER_TEAM, { ...OWNING_TEAM, members: [] }],
        }),
      );
    });

    describe("when they open a settings page", () => {
      /** @scenario A genuine non-member is still refused */
      it("still resolves a context, and the chrome still refuses them", () => {
        const { result } = renderResolution();

        // A resolved context is what lets the chrome render the refusal at
        // all; leaving it undefined would hang the page on a loading screen.
        expect(result.current.team).toBeDefined();
        expect(
          chromeWouldRefuse({
            team: result.current.team,
            organizationRole: result.current.organizationRole,
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a project named in the address bar that belongs to another team", () => {
    describe("when the member opens it", () => {
      /** @scenario A project named in the URL still resolves its own team */
      it("resolves the addressed team, refusal and all", () => {
        mockRouter.query = { project: "platform-app" };
        mockRouter.route = "/[project]";
        mockRouter.pathname = "/[project]";
        mockRouter.asPath = "/platform-app";

        const { result } = renderResolution();

        expect(result.current.team?.id).toBe("team-platform");
        expect(
          chromeWouldRefuse({
            team: result.current.team,
            organizationRole: result.current.organizationRole,
          }),
        ).toBe(true);
      });
    });
  });
});
