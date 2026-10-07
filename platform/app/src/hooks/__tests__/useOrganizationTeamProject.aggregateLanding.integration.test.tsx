/**
 * @vitest-environment jsdom
 *
 * ADR-144 block F: an admin opens an aggregate project on purpose, so the
 * browser never remembers it as the selected project, and a selection
 * remembered before that rule (or from another tab) never lands anyone on it.
 * The server's landing rule already skips aggregates; this is the client's
 * remembered-selection path, which the server never sees.
 *
 * Executes the real hook with only its boundaries stubbed, the same way as
 * useOrganizationTeamProject.custom-role-org-admin.integration.test.tsx.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOrganizationsQuery,
  mockRouter,
  mockLocalStorage,
  idleQuery,
  USER_ID,
  grantedPermissions,
} = vi.hoisted(() => ({
  mockOrganizationsQuery: vi.fn(),
  grantedPermissions: { current: [] as string[] },
  idleQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetched: true,
  }),
  mockRouter: {
    query: {} as Record<string, string>,
    route: "/",
    pathname: "/",
    asPath: "/",
    push: vi.fn(),
    replace: vi.fn(),
  },
  mockLocalStorage: {
    selectedOrganizationId: "",
    selectedTeamId: "",
    selectedProjectSlug: "",
  } as Record<string, string>,
  USER_ID: "user-ana",
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: { getAll: { useQuery: mockOrganizationsQuery } },
    authz: {
      effectivePermissions: {
        useQuery: () => ({
          data: { permissions: grantedPermissions.current },
          isLoading: false,
          isFetched: true,
        }),
      },
    },
    sharedTrace: { get: { useQuery: idleQuery } },
    identity: { myTestArrival: { useQuery: idleQuery } },
    publicEnv: { useQuery: idleQuery },
    modelProvider: { getAllForProject: { useQuery: idleQuery } },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: USER_ID } },
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

const ORDINARY = {
  id: "proj-app",
  name: "Support Bot",
  slug: "support-bot",
  kind: "application",
};
const AGGREGATE = {
  id: "proj-aggregate",
  name: "Company Traces",
  slug: "company-traces",
  kind: "aggregate",
};

const member = { userId: USER_ID, role: "ADMIN" };

/**
 * An admin's organisation. `aggregateTeamHoldsOnlyIt` puts the aggregate on a
 * team of its own; otherwise it sits beside the ordinary project.
 */
function organizationFor({
  aggregateTeamHoldsOnlyIt,
}: {
  aggregateTeamHoldsOnlyIt: boolean;
}) {
  const teams = aggregateTeamHoldsOnlyIt
    ? [
        {
          id: "team-company",
          name: "Company",
          slug: "company",
          isPersonal: false,
          ownerUserId: null,
          members: [member],
          projects: [AGGREGATE],
        },
        {
          id: "team-support",
          name: "Support",
          slug: "support",
          isPersonal: false,
          ownerUserId: null,
          members: [member],
          projects: [ORDINARY],
        },
      ]
    : [
        {
          id: "team-support",
          name: "Support",
          slug: "support",
          isPersonal: false,
          ownerUserId: null,
          members: [member],
          projects: [AGGREGATE, ORDINARY],
        },
      ];
  return {
    data: [
      {
        id: "org-acme",
        name: "ACME",
        slug: "acme",
        primaryIntent: null,
        members: [{ role: "ADMIN" }],
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

describe("useOrganizationTeamProject with an aggregate project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantedPermissions.current = [];
    mockRouter.query = {};
    for (const key of Object.keys(mockLocalStorage)) {
      mockLocalStorage[key] = "";
    }
  });

  afterEach(() => {
    cleanup();
  });

  describe.each([
    { aggregateTeamHoldsOnlyIt: false, where: "beside an ordinary project" },
    { aggregateTeamHoldsOnlyIt: true, where: "on a team of its own" },
  ])("given an aggregate $where", ({ aggregateTeamHoldsOnlyIt }) => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        organizationFor({ aggregateTeamHoldsOnlyIt }),
      );
    });

    describe("when the remembered selection names the aggregate", () => {
      /** @scenario "Landing never resolves to an aggregate from a remembered selection" */
      it("lands on the ordinary project instead", () => {
        mockLocalStorage.selectedOrganizationId = "org-acme";
        mockLocalStorage.selectedTeamId = aggregateTeamHoldsOnlyIt
          ? "team-company"
          : "team-support";
        mockLocalStorage.selectedProjectSlug = AGGREGATE.slug;

        const { result } = renderResolution();

        expect(result.current.project?.id).toBe(ORDINARY.id);
        expect(mockLocalStorage.selectedProjectSlug).toBe(ORDINARY.slug);
      });
    });

    describe("when the address names the aggregate", () => {
      /** @scenario "Landing never resolves to an aggregate from a remembered selection" */
      it("opens the aggregate and does not remember it", () => {
        mockLocalStorage.selectedOrganizationId = "org-acme";
        mockLocalStorage.selectedTeamId = "team-support";
        mockLocalStorage.selectedProjectSlug = ORDINARY.slug;
        mockRouter.query = { project: AGGREGATE.slug };

        const { result } = renderResolution();

        expect(result.current.project?.id).toBe(AGGREGATE.id);
        expect(mockLocalStorage.selectedProjectSlug).toBe(ORDINARY.slug);
        expect(mockLocalStorage.selectedTeamId).toBe("team-support");
      });
    });
  });

  describe("given an admin holding every permission", () => {
    const ADMIN_PERMISSIONS = [
      "traces:view",
      "annotations:manage",
      "triggers:manage",
      "datasets:manage",
      "analytics:manage",
      "project:manage",
    ];

    beforeEach(() => {
      grantedPermissions.current = ADMIN_PERMISSIONS;
      mockOrganizationsQuery.mockReturnValue(
        organizationFor({ aggregateTeamHoldsOnlyIt: false }),
      );
    });

    describe("when the open project is the aggregate", () => {
      /** @scenario "The app marks the aggregate and offers no way to add data to it" */
      it("denies every write the server refuses and keeps reads and managing the project", () => {
        mockRouter.query = { project: AGGREGATE.slug };

        const { result } = renderResolution();

        expect(result.current.project?.id).toBe(AGGREGATE.id);
        expect(result.current.hasPermission("annotations:manage")).toBe(false);
        expect(result.current.hasPermission("triggers:manage")).toBe(false);
        expect(result.current.hasPermission("datasets:manage")).toBe(false);
        expect(result.current.hasPermission("analytics:manage")).toBe(false);
        expect(result.current.hasPermission("traces:view")).toBe(true);
        expect(result.current.hasPermission("project:manage")).toBe(true);
      });
    });

    describe("when the open project is an ordinary one", () => {
      it("grants the same writes", () => {
        mockRouter.query = { project: ORDINARY.slug };

        const { result } = renderResolution();

        expect(result.current.project?.id).toBe(ORDINARY.id);
        expect(result.current.hasPermission("annotations:manage")).toBe(true);
        expect(result.current.hasPermission("triggers:manage")).toBe(true);
      });
    });
  });
});
