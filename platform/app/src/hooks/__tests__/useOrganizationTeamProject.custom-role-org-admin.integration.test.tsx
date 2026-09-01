/**
 * @vitest-environment jsdom
 *
 * An organization admin who also holds a custom team role must not lose in
 * the browser what the server grants them. Both server paths answer the same
 * way — an ORGANIZATION-scoped ADMIN binding grants everything, custom team
 * role or not (`checkPermissionFromBindings` in rbac.ts; `bindingGrants` in
 * packages/authz/src/matchers.ts) — so the hook's team-permission resolution
 * has to fall back to the org-admin answer before it applies the custom
 * role's own permission list.
 *
 * These tests execute the real hook, with only its boundaries stubbed, the
 * same way as useOrganizationTeamProject.team-membership.integration.test.tsx.
 *
 * Spec: specs/rbac/fetch-org-role-permission-resolution.feature
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

const USER_ID = "user-analyst";

/** A custom role that grants analytics viewing and nothing else. */
const ANALYTICS_ONLY_ROLE = { permissions: ["analytics:view"] };

function organizationWith({ organizationRole }: { organizationRole: string }) {
  return {
    data: [
      {
        id: "org-acme",
        name: "ACME",
        slug: "acme",
        primaryIntent: null,
        members: [{ role: organizationRole }],
        teams: [
          {
            id: "team-data",
            name: "ACME Data",
            slug: "acme-data",
            isPersonal: false,
            ownerUserId: null,
            members: [
              {
                userId: USER_ID,
                role: "CUSTOM",
                assignedRole: ANALYTICS_ONLY_ROLE,
              },
            ],
            projects: [{ id: "proj-data", name: "Data App", slug: "data-app" }],
          },
        ],
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

describe("useOrganizationTeamProject with a custom team role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.query = {};
    for (const key of Object.keys(mockLocalStorage)) {
      mockLocalStorage[key] = "";
    }
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an org admin holding a custom team role", () => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        organizationWith({ organizationRole: "ADMIN" }),
      );
    });

    /** @scenario "An org admin holding a custom team role keeps admin access in the browser" */
    it("grants a team-scoped permission the custom role omits", () => {
      const { result } = renderResolution();

      expect(result.current.organizationRole).toBe("ADMIN");
      expect(result.current.hasPermission("datasets:manage")).toBe(true);
    });

    /** @scenario "An org admin holding a custom team role keeps admin access in the browser" */
    it("still grants what the custom role itself lists", () => {
      const { result } = renderResolution();

      expect(result.current.hasPermission("analytics:view")).toBe(true);
    });
  });

  describe("given an org member holding the same custom team role", () => {
    beforeEach(() => {
      mockOrganizationsQuery.mockReturnValue(
        organizationWith({ organizationRole: "MEMBER" }),
      );
    });

    /** @scenario "An org admin holding a custom team role keeps admin access in the browser" */
    it("keeps refusing what the custom role omits", () => {
      const { result } = renderResolution();

      expect(result.current.organizationRole).toBe("MEMBER");
      expect(result.current.hasPermission("analytics:view")).toBe(true);
      expect(result.current.hasPermission("datasets:manage")).toBe(false);
    });
  });
});
