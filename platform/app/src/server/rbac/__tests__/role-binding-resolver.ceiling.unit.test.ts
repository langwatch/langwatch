import { describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  resolveApiKeyPermission,
  type ScopeRef,
} from "../role-binding-resolver";

/**
 * The API-key ceiling: `effective = ApiKey.bindings ∩ user.bindings`.
 *
 * The sibling suites exercise `checkRoleBindingPermission` — the single
 * principal check. This one covers the two-principal intersection on top of
 * it, which is what makes a key unable to outlive or outrank its owner.
 *
 * @see specs/api-keys/scope-based-permissions.feature
 */

type BindingRecord = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

const ORG_ID = "org1";
const USER_ID = "user1";
const API_KEY_ID = "apikey1";
const TEAM_ID = "team1";
const PROJECT_ID = "proj1";

const projectScope: ScopeRef = {
  type: "project",
  id: PROJECT_ID,
  teamId: TEAM_ID,
};

const teamBinding = (role: TeamUserRole): BindingRecord => ({
  role,
  customRoleId: null,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: TEAM_ID,
});

/**
 * Dispatches on the `where` clause rather than call order: the owning user's
 * bindings are fetched as two parallel queries (direct + group), so an
 * order-based mock would be answering the wrong question.
 */
function makePrisma({
  apiKeyBindings = [] as BindingRecord[],
  userBindings = [] as BindingRecord[],
  groupBindings = [] as BindingRecord[],
  /** Org role of the owner, or null for "not a legacy-membership user". */
  legacyOrgRole = null as OrganizationUserRole | null,
  legacyTeamRole = null as TeamUserRole | null,
  /** Organization the legacy team actually belongs to. */
  legacyTeamOrgId = ORG_ID as string,
} = {}) {
  const findMany = vi.fn(
    async ({ where }: { where: Record<string, unknown> }) => {
      if (where.apiKeyId) return apiKeyBindings;
      if (where.group) return groupBindings;
      if (where.userId) return userBindings;
      return [];
    },
  );

  return {
    prisma: {
      roleBinding: {
        findMany,
        // Step 4's legacy fallback gate. Defaulted to "this user holds
        // bindings", which switches the fallback off, so the cases above stay
        // decisions about the binding path alone.
        count: vi.fn().mockResolvedValue(legacyOrgRole === null ? 1 : 0),
      },
      teamUser: {
        // Answers according to the where-clause, so a query that fails to
        // constrain the team to this organization is visible rather than
        // silently satisfied by a fixture that ignores its own filter.
        findFirst: vi.fn(async ({ where }: any) => {
          if (!legacyTeamRole) return null;
          const wantsOrg = where?.team?.organizationId;
          if (wantsOrg !== undefined && wantsOrg !== legacyTeamOrgId) {
            return null;
          }
          return { role: legacyTeamRole };
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue(
          legacyOrgRole === null
            ? null
            : {
                orgMemberships: [{ role: legacyOrgRole }],
                groupMemberships: [],
              },
        ),
      },
      customRole: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Parameters<typeof resolveApiKeyPermission>[0]["prisma"],
    findMany,
  };
}

const resolve = ({
  prisma,
  userId = USER_ID as string | null,
}: {
  prisma: Parameters<typeof resolveApiKeyPermission>[0]["prisma"];
  userId?: string | null;
}) =>
  resolveApiKeyPermission({
    prisma,
    apiKeyId: API_KEY_ID,
    userId,
    organizationId: ORG_ID,
    scope: projectScope,
    permission: "project:update",
  });

describe("resolveApiKeyPermission()", () => {
  describe("given a key owned by a user", () => {
    describe("when both the key and the owner grant the permission", () => {
      it("permits the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
          userBindings: [teamBinding(TeamUserRole.ADMIN)],
        });

        await expect(resolve({ prisma })).resolves.toBe(true);
      });
    });

    describe("when the key grants it but the owner does not", () => {
      /**
       * The reason the ceiling exists: a key must never exceed the person it
       * belongs to, however it was minted.
       */
      it("denies the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
          userBindings: [teamBinding(TeamUserRole.VIEWER)],
        });

        await expect(resolve({ prisma })).resolves.toBe(false);
      });
    });

    describe("when the owner grants it but the key does not", () => {
      it("denies the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.VIEWER)],
          userBindings: [teamBinding(TeamUserRole.ADMIN)],
        });

        await expect(resolve({ prisma })).resolves.toBe(false);
      });
    });

    describe("when neither grants the permission", () => {
      it("denies the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.VIEWER)],
          userBindings: [teamBinding(TeamUserRole.VIEWER)],
        });

        await expect(resolve({ prisma })).resolves.toBe(false);
      });
    });

    describe("when the owner has been demoted since the key was minted", () => {
      /** The auto-degradation the ceiling promises, at the resolver level. */
      it("stops honouring the key's own grant", async () => {
        const minted = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
          userBindings: [teamBinding(TeamUserRole.ADMIN)],
        });
        await expect(resolve({ prisma: minted.prisma })).resolves.toBe(true);

        const demoted = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
          userBindings: [teamBinding(TeamUserRole.VIEWER)],
        });
        await expect(resolve({ prisma: demoted.prisma })).resolves.toBe(false);
      });
    });

    describe("when the owner has left the organization", () => {
      /**
       * The direct-binding query is gated on current org membership, so an
       * offboarded owner returns no bindings at all — the key goes with them.
       */
      it("denies the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
          userBindings: [],
        });

        await expect(resolve({ prisma })).resolves.toBe(false);
      });
    });

    describe("when the owner's only grant comes through a group", () => {
      it("permits the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
          groupBindings: [teamBinding(TeamUserRole.ADMIN)],
        });

        await expect(resolve({ prisma })).resolves.toBe(true);
      });
    });

    describe("when the key is denied", () => {
      /**
       * The owner is never consulted for a key that already fails on its own
       * bindings — an over-privileged owner cannot rescue an under-privileged
       * key.
       */
      it("does not consult the owner's bindings", async () => {
        const { prisma, findMany } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.VIEWER)],
          userBindings: [teamBinding(TeamUserRole.ADMIN)],
        });

        await resolve({ prisma });

        const queried = findMany.mock.calls.map(([args]) => args.where);
        expect(queried.some((where) => where.apiKeyId)).toBe(true);
        expect(queried.some((where) => where.userId ?? where.group)).toBe(
          false,
        );
      });
    });
  });

  describe("given a service key with no owning user", () => {
    describe("when the key's own bindings grant the permission", () => {
      /**
       * There is no user to intersect with, so the key's bindings are the
       * whole ceiling. Pinned because it is the one path that skips the
       * intersection entirely.
       */
      it("permits the request without a user check", async () => {
        const { prisma, findMany } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
        });

        await expect(resolve({ prisma, userId: null })).resolves.toBe(true);

        const queried = findMany.mock.calls.map(([args]) => args.where);
        expect(queried.some((where) => where.userId ?? where.group)).toBe(
          false,
        );
      });
    });

    describe("when the key's own bindings do not grant the permission", () => {
      it("denies the request", async () => {
        const { prisma } = makePrisma({
          apiKeyBindings: [teamBinding(TeamUserRole.VIEWER)],
        });

        await expect(resolve({ prisma, userId: null })).resolves.toBe(false);
      });
    });
  });
  describe("given an owner whose access predates the RoleBinding migration", () => {
    /**
     * The population this fallback exists for is DEFINED by holding zero
     * RoleBindings, so step 3 returns false for every permission it is asked
     * about. Fixing only the mint-side ceiling therefore fixed nothing: the
     * key minted successfully and then every request made with it was refused
     * here — the failure moved from mint time to the first tool call, after
     * the turn had already started streaming.
     */
    /** @scenario "A key minted from legacy membership works at request time" */
    it("permits the request its legacy role covers", async () => {
      const { prisma } = makePrisma({
        apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
        // No user bindings anywhere — the whole point.
        userBindings: [],
        legacyOrgRole: OrganizationUserRole.MEMBER,
        legacyTeamRole: TeamUserRole.ADMIN,
      });

      await expect(resolve({ prisma })).resolves.toBe(true);
    });

    it("still refuses what that legacy role does not cover", async () => {
      const { prisma } = makePrisma({
        apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
        userBindings: [],
        legacyOrgRole: OrganizationUserRole.MEMBER,
        // VIEWER is read-only, so it cannot carry `project:update`.
        legacyTeamRole: TeamUserRole.VIEWER,
      });

      await expect(resolve({ prisma })).resolves.toBe(false);
    });

    it("caps an EXTERNAL member by their organization role, not their team role", async () => {
      const { prisma } = makePrisma({
        apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
        userBindings: [],
        legacyOrgRole: OrganizationUserRole.EXTERNAL,
        legacyTeamRole: TeamUserRole.ADMIN,
      });

      await expect(resolve({ prisma })).resolves.toBe(false);
    });
  });
  describe("given a legacy row on a team belonging to a different organization", () => {
    /**
     * The membership gate proves the USER belongs to the org being asked
     * about; it says nothing about the TEAM. `loadScopeResolution` constrains
     * the team too (`team: { organizationId }`), and this function's docstring
     * claims to use the same predicate — so a claimed parity that does not
     * hold is exactly the defect class this fallback was rewritten to remove.
     *
     * Unreachable today, since both callers derive the scope from a validated
     * project or team. Pinned so it stays that way.
     */
    it("grants nothing from the other organization's role", async () => {
      const { prisma } = makePrisma({
        apiKeyBindings: [teamBinding(TeamUserRole.ADMIN)],
        userBindings: [],
        legacyOrgRole: OrganizationUserRole.MEMBER,
        legacyTeamRole: TeamUserRole.ADMIN,
        legacyTeamOrgId: "some-other-org",
      });

      await expect(resolve({ prisma })).resolves.toBe(false);
    });
  });
});
