import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { GrantsAccessListingRepository } from "../access-listing.grants.repository";
import { PrismaAccessListingRepository } from "../access-listing.prisma.repository";

/**
 * The grants head speaks the ledger's vocabulary; the Access surface renders
 * the legacy one. These tests pin the translation - the same one the fold
 * writes onto the compat rows - and the decoration fences, because a row
 * translated differently from how the compat head would have carried it is a
 * listing that changes on the day an organization cuts over.
 */

const ORG = "org-1";

type GrantRowSeed = {
  id: string;
  principalType: string;
  principalId: string | null;
  roleKey: string | null;
  legacyRole?: string | null;
  scopeType?: string;
  scopeId?: string;
  occurredAt?: Date;
};

const grantRow = (seed: GrantRowSeed) => ({
  id: seed.id,
  organizationId: ORG,
  principalType: seed.principalType,
  principalId: seed.principalId,
  roleKey: seed.roleKey,
  legacyRole: seed.legacyRole ?? null,
  scopeType: seed.scopeType ?? "TEAM",
  scopeId: seed.scopeId ?? "team-1",
  occurredAt: seed.occurredAt ?? new Date("2026-01-05T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
});

const prismaWith = (data: {
  grants?: ReturnType<typeof grantRow>[];
  users?: Array<Record<string, unknown>>;
  groups?: Array<Record<string, unknown>>;
  apiKeys?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  groupMemberships?: Array<Record<string, unknown>>;
}) => {
  const prisma = {
    grant: { findMany: vi.fn().mockResolvedValue(data.grants ?? []) },
    user: { findMany: vi.fn().mockResolvedValue(data.users ?? []) },
    group: { findMany: vi.fn().mockResolvedValue(data.groups ?? []) },
    apiKey: { findMany: vi.fn().mockResolvedValue(data.apiKeys ?? []) },
    role: { findMany: vi.fn().mockResolvedValue(data.roles ?? []) },
    groupMembership: {
      findMany: vi.fn().mockResolvedValue(data.groupMemberships ?? []),
    },
  };
  return {
    prisma,
    repository: new GrantsAccessListingRepository(
      prisma as unknown as Prisma.TransactionClient,
    ),
  };
};

describe("GrantsAccessListingRepository", () => {
  describe("when the grant rows carry facts the legacy vocabulary cannot express", () => {
    /** @scenario "Dormant facts never appear as bindings in a listing" */
    it("skips every fact the legacy vocabulary cannot carry instead of defaulting it", async () => {
      const { repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-lite",
            principalType: "USER",
            principalId: "external-erin",
            roleKey: "lite-member",
            scopeType: "ORGANIZATION",
            scopeId: ORG,
          }),
          grantRow({
            id: "g-null",
            principalType: "USER",
            principalId: "alice",
            roleKey: null,
          }),
          // The project-credential fact is the one the roleKey and scope
          // filters do NOT catch: a listable PROJECT scope and a listable
          // "admin" key, dormant only because its principal is collective.
          // Listed, it would render as an ADMIN binding belonging to nobody.
          grantRow({
            id: "g-project-credential",
            principalType: "PROJECT",
            principalId: "project-1",
            roleKey: "admin",
            scopeType: "PROJECT",
            scopeId: "project-1",
          }),
          grantRow({
            id: "g-platform",
            principalType: "USER",
            principalId: "alice",
            roleKey: "admin",
            scopeType: "PLATFORM",
            scopeId: "platform",
          }),
          grantRow({
            id: "g-member",
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
          }),
        ],
        users: [
          { id: "alice", name: "Alice", email: "a@x.io", image: null },
          { id: "external-erin", name: "Erin", email: "e@x.io", image: null },
        ],
      });

      const rows = await repository.findUserBindings({
        organizationId: ORG,
        userId: "alice",
      });

      expect(rows.map((row) => row.id)).toEqual(["g-member"]);
    });

    /** @scenario "Dormant facts never appear as bindings in a listing" */
    it("asks the query itself to exclude resource, platform and dormant rows", async () => {
      const { prisma, repository } = prismaWith({});

      await repository.findOrganizationBindings({ organizationId: ORG });

      const call = prisma.grant.findMany.mock.calls[0]?.[0];
      const where = call?.where;
      expect(where).toBeDefined();
      expect(where.organizationId).toBe(ORG);
      expect(where.scopeType).toEqual({
        in: ["ORGANIZATION", "TEAM", "PROJECT"],
      });
      expect(where.principalType).toEqual({ in: ["USER", "GROUP", "API_KEY"] });
      expect(where.AND).toContainEqual({
        OR: [
          { roleKey: { in: ["admin", "member", "viewer"] } },
          { roleKey: { startsWith: "custom:" } },
        ],
      });
      // Business time, then id as the tiebreak: rows imported in one batch
      // share an occurredAt, and without the second key they would reshuffle
      // between reads of the same unchanged page.
      expect(call?.orderBy).toEqual([{ occurredAt: "asc" }, { id: "asc" }]);
    });
  });

  describe("when a custom grant carries the built-in role its import preserved", () => {
    it("lists the preserved role, exactly as the compat head reproduces it", async () => {
      const { repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-custom",
            principalType: "USER",
            principalId: "alice",
            roleKey: "custom:role-9",
            legacyRole: "ADMIN",
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
        roles: [
          {
            id: "role-9",
            organizationId: ORG,
            name: "SRE",
            description: null,
            permissions: ["traces:view"],
            kind: "custom",
            occurredAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-02T00:00:00Z"),
          },
        ],
      });

      const rows = await repository.findUserBindings({
        organizationId: ORG,
        userId: "alice",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.role).toBe("ADMIN");
      expect(rows[0]?.customRoleId).toBe("role-9");
      expect(rows[0]?.customRole).toEqual({
        id: "role-9",
        name: "SRE",
        permissions: ["traces:view"],
      });
    });
  });

  describe("when the listing is the organization's whole table", () => {
    it("drops a row whose principal no longer resolves within the organization", async () => {
      const { prisma, repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-member",
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
          }),
          grantRow({
            id: "g-departed",
            principalType: "USER",
            principalId: "departed-dave",
            roleKey: "member",
          }),
          grantRow({
            id: "g-foreign-key",
            principalType: "API_KEY",
            principalId: "key-foreign",
            roleKey: "viewer",
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
      });

      const rows = await repository.findOrganizationBindings({
        organizationId: ORG,
      });

      expect(rows.map((row) => row.id)).toEqual(["g-member"]);
      // In production a departed member's User row still exists and only the
      // membership predicate excludes it, so pin the predicate itself — the
      // row-drop above only proves drop-on-missing-decoration.
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgMemberships: { some: { organizationId: ORG } },
          }),
        }),
      );
    });

    it("keeps a per-user row whose decoration is missing, like the legacy per-user read", async () => {
      const { repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-1",
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
          }),
        ],
      });

      const rows = await repository.findUserBindings({
        organizationId: ORG,
        userId: "alice",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.user).toBeNull();
    });
  });

  describe("when a binding row is listed", () => {
    it("carries the grant's own id and its business time", async () => {
      const occurredAt = new Date("2023-04-05T00:00:00Z");
      const { repository } = prismaWith({
        grants: [
          grantRow({
            id: "rb_adopted_id",
            principalType: "USER",
            principalId: "alice",
            roleKey: "admin",
            occurredAt,
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
      });

      const rows = await repository.findUserBindings({
        organizationId: ORG,
        userId: "alice",
      });

      expect(rows[0]?.id).toBe("rb_adopted_id");
      expect(rows[0]?.createdAt).toEqual(occurredAt);
    });
  });

  describe("when the two heads list the same imported binding", () => {
    /** @scenario "A listing row keeps its identity across the cutover" */
    it("lists it under the same id on both heads", async () => {
      // The imported grant ADOPTS the binding's row id, so the two heads are
      // the same row to a consumer holding its id.
      const sharedId = "rb_1";
      const legacyPrisma = {
        roleBinding: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: sharedId,
              organizationId: ORG,
              userId: "alice",
              groupId: null,
              apiKeyId: null,
              role: "MEMBER",
              customRoleId: null,
              scopeType: "TEAM",
              scopeId: "team-1",
              createdAt: new Date("2026-01-05T00:00:00Z"),
              user: {
                id: "alice",
                name: "Alice",
                email: "a@x.io",
                image: null,
              },
              group: null,
              apiKey: null,
              customRole: null,
            },
          ]),
        },
      };
      const legacy = new PrismaAccessListingRepository(
        legacyPrisma as unknown as Prisma.TransactionClient,
      );
      const { repository: grants } = prismaWith({
        grants: [
          grantRow({
            id: sharedId,
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
      });

      const [legacyRows, grantRows] = await Promise.all([
        legacy.findUserBindings({ organizationId: ORG, userId: "alice" }),
        grants.findUserBindings({ organizationId: ORG, userId: "alice" }),
      ]);

      expect(legacyRows[0]?.id).toBe(sharedId);
      expect(grantRows[0]?.id).toBe(sharedId);
      // Not just the id: the whole rendered row. The two heads are read by
      // one page, so any column that differs is a cell that changes on the
      // day the organization cuts over. `createdAt` is the one to watch -
      // legacy reports the binding's own createdAt, the grants head reports
      // the fact's occurredAt, and they agree only because the import
      // backdates it. Stamped at import time instead, every "since when" on
      // the Access page would jump to cutover day.
      expect(grantRows[0]).toEqual(legacyRows[0]);
    });
  });

  describe("when role decoration points outside the organization", () => {
    it("renders no role rather than another organization's", async () => {
      const { prisma, repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-1",
            principalType: "USER",
            principalId: "alice",
            roleKey: "custom:foreign-role",
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
        roles: [],
      });

      const rows = await repository.findUserBindings({
        organizationId: ORG,
        userId: "alice",
      });

      expect(rows[0]?.customRole).toBeNull();
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
        }),
      );
    });
  });

  describe("when team member bindings are listed", () => {
    it("pre-seeds every requested team and fences on current membership", async () => {
      const { prisma, repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-1",
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
            scopeType: "TEAM",
            scopeId: "team-1",
          }),
          grantRow({
            id: "g-2",
            principalType: "USER",
            principalId: "departed-dave",
            roleKey: "member",
            scopeType: "TEAM",
            scopeId: "team-1",
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
      });

      const byTeam = await repository.findTeamMemberBindings({
        organizationId: ORG,
        teamIds: ["team-1", "team-empty"],
      });

      expect([...byTeam.keys()].sort()).toEqual(["team-1", "team-empty"]);
      expect(byTeam.get("team-empty")).toEqual([]);
      expect(byTeam.get("team-1")?.map((member) => member.userId)).toEqual([
        "alice",
      ]);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgMemberships: { some: { organizationId: ORG } },
          }),
        }),
      );
    });
  });

  describe("when the synthesis read expands the user's groups", () => {
    it("keeps a group grant only when the user is in that group in the grant's own organization", async () => {
      const { repository } = prismaWith({
        groupMemberships: [
          { groupId: "group-mine", group: { organizationId: ORG } },
        ],
        grants: [
          grantRow({
            id: "g-direct",
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
          }),
          grantRow({
            id: "g-via-group",
            principalType: "GROUP",
            principalId: "group-mine",
            roleKey: "viewer",
          }),
          {
            ...grantRow({
              id: "g-foreign-group",
              principalType: "GROUP",
              principalId: "group-mine",
              roleKey: "viewer",
            }),
            organizationId: "org-other",
          },
        ],
      });

      const rows = await repository.findBindingsForSynthesis({
        orgIds: [ORG, "org-other"],
        userId: "alice",
      });

      expect(
        rows.map((row) => `${row.organizationId}:${row.scopeId}:${row.role}`),
      ).toEqual([`${ORG}:team-1:MEMBER`, `${ORG}:team-1:VIEWER`]);
    });
  });

  describe("when the role editor's roles are listed", () => {
    /** @scenario "A cut-over organization's role editor lists roles from the ledger's head" */
    it("serves the Role head's rows in the CustomRole column shape, business time first", async () => {
      const { prisma, repository } = prismaWith({
        roles: [
          {
            id: "role-1",
            organizationId: ORG,
            name: "SRE",
            description: "on call",
            permissions: ["traces:view"],
            kind: "custom",
            occurredAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-02T00:00:00Z"),
          },
        ],
      });

      const roles = await repository.findUserCreatedRoles({
        organizationId: ORG,
      });

      expect(roles).toEqual([
        {
          id: "role-1",
          organizationId: ORG,
          name: "SRE",
          description: "on call",
          permissions: ["traces:view"],
          kind: "custom",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ]);
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, kind: "custom" },
        }),
      );
    });
  });

  describe("when the listing is one group's own bindings", () => {
    it("renders the row against the group and fences the name lookup to the organization", async () => {
      const { prisma, repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-group",
            principalType: "GROUP",
            principalId: "group-1",
            roleKey: "member",
          }),
        ],
        groups: [{ id: "group-1", name: "SRE", scimSource: null }],
      });

      const rows = await repository.findGroupBindings({
        organizationId: ORG,
        groupId: "group-1",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.groupId).toBe("group-1");
      expect(rows[0]?.group).toEqual({
        id: "group-1",
        name: "SRE",
        scimSource: null,
      });
      expect(rows[0]?.userId).toBeNull();
      expect(rows[0]?.apiKeyId).toBeNull();
      // The fence that stops another organization's group name rendering on
      // this page - the only thing bounding a lookup keyed by a bare id.
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["group-1"] }, organizationId: ORG },
        }),
      );
    });
  });

  describe("when the listing is a scope's own bindings", () => {
    it("asks nothing at all when there are no scopes to ask about", async () => {
      const { prisma, repository } = prismaWith({});

      const rows = await repository.findScopeBindings({
        organizationId: ORG,
        scopeType: "TEAM",
        scopeIds: [],
      });

      expect(rows).toEqual([]);
      expect(prisma.grant.findMany).not.toHaveBeenCalled();
    });

    it("drops a row whose principal no longer resolves in the organization", async () => {
      const { repository } = prismaWith({
        grants: [
          grantRow({
            id: "g-present",
            principalType: "USER",
            principalId: "alice",
            roleKey: "member",
          }),
          grantRow({
            id: "g-departed",
            principalType: "USER",
            principalId: "departed-dave",
            roleKey: "admin",
          }),
        ],
        users: [{ id: "alice", name: "Alice", email: "a@x.io", image: null }],
      });

      const rows = await repository.findScopeBindings({
        organizationId: ORG,
        scopeType: "TEAM",
        scopeIds: ["team-1"],
      });

      expect(rows.map((row) => row.id)).toEqual(["g-present"]);
    });
  });

  describe("when the listing is a member's own access breakdown", () => {
    it("asks about the member's groups as well as the member", async () => {
      const { prisma, repository } = prismaWith({});

      await repository.findUserAndGroupBindings({
        organizationId: ORG,
        userId: "alice",
        groupIds: ["group-1", "group-2"],
      });

      const where = prisma.grant.findMany.mock.calls[0]?.[0]?.where;
      expect(where.AND).toContainEqual({
        OR: [
          { principalType: "USER", principalId: "alice" },
          {
            principalType: "GROUP",
            principalId: { in: ["group-1", "group-2"] },
          },
        ],
      });
    });

    it("asks only about the member when they belong to no group", async () => {
      const { prisma, repository } = prismaWith({});

      await repository.findUserAndGroupBindings({
        organizationId: ORG,
        userId: "alice",
        groupIds: [],
      });

      const where = prisma.grant.findMany.mock.calls[0]?.[0]?.where;
      expect(where.AND).toContainEqual({
        OR: [{ principalType: "USER", principalId: "alice" }],
      });
    });
  });
});
