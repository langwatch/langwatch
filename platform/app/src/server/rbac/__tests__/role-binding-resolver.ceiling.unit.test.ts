import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
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
      roleBinding: { findMany },
      teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
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
});
