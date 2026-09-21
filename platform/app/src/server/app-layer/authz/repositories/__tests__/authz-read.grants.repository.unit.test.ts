import { AuthzEngine } from "@langwatch/authz";
import type { GrantRowShape } from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "~/generated/prisma/client";

import { GrantsAuthzReadRepository } from "../authz-read.grants.repository";

/** Grants remain tenant-scoped, membership-gated, and private to their owner. */
const clientFor = (models: Record<string, unknown>) =>
  models as unknown as Prisma.TransactionClient;

const member = () =>
  vi.fn().mockResolvedValue({ userId: "alice" }) as ReturnType<typeof vi.fn>;

const bindingGrantSelect = {
  id: true,
  organizationId: true,
  principalType: true,
  principalId: true,
  roleKey: true,
  legacyRole: true,
  source: true,
  scopeType: true,
  scopeId: true,
  token: true,
  permission: true,
  resourceKind: true,
  projectId: true,
  createdByUserId: true,
  expiresAt: true,
  maxViews: true,
  occurredAt: true,
} as const satisfies Prisma.GrantSelect;

const grantRow = (overrides: Partial<GrantRowShape> = {}): GrantRowShape => ({
  id: "grant-1",
  organizationId: "org-1",
  principalType: "USER",
  principalId: "alice",
  roleKey: "member",
  legacyRole: null,
  source: "grants-service",
  scopeType: "TEAM",
  scopeId: "team-1",
  token: null,
  permission: null,
  resourceKind: null,
  projectId: null,
  createdByUserId: null,
  expiresAt: null,
  maxViews: null,
  occurredAt: new Date("2025-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("GrantsAuthzReadRepository", () => {
  describe("when findOrganizationMembership reads the membership row", () => {
    it("reads the membership row, which the ledger never projected", async () => {
      const findFirst = vi
        .fn()
        .mockResolvedValue({ role: "ADMIN", disabledAt: null });
      const repository = new GrantsAuthzReadRepository(
        clientFor({ organizationUser: { findFirst } }),
      );

      expect(
        await repository.findOrganizationMembership({
          userId: "alice",
          organizationId: "org-1",
        }),
      ).toEqual({ role: "ADMIN", disabled: false });
      expect(findFirst).toHaveBeenCalledWith({
        where: { userId: "alice", organizationId: "org-1" },
        select: { role: true, disabledAt: true },
      });
    });

    it("reports a seat-disabled row as disabled, so the denial can name the seat", async () => {
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          organizationUser: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ role: "MEMBER", disabledAt: new Date() }),
          },
        }),
      );

      expect(
        await repository.findOrganizationMembership({
          userId: "alice",
          organizationId: "org-1",
        }),
      ).toEqual({ role: "MEMBER", disabled: true });
    });
  });

  describe("when findUserBindings collects a user's grants", () => {
    /** @scenario "A grant collection reads live grant facts" */
    it("reads the user's own grants at the three binding scopes", async () => {
      const findMany = vi.fn().mockResolvedValue([
        grantRow({ roleKey: "admin" }),
        grantRow({
          id: "grant-2",
          roleKey: "custom:role-9",
          scopeType: "PROJECT",
          scopeId: "proj-1",
        }),
      ]);
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          organizationUser: { findFirst: member() },
          grant: { findMany },
        }),
      );

      const bindings = await repository.findUserBindings({
        userId: "alice",
        organizationId: "org-1",
      });

      expect(findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          principalType: "USER",
          principalId: "alice",
          scopeType: { in: ["ORGANIZATION", "TEAM", "PROJECT"] },
          revokedAt: null,
        },
        select: bindingGrantSelect,
      });
      expect(bindings).toEqual([
        {
          roleKey: "admin",
          scopeType: "TEAM",
          scopeId: "team-1",
          viaGroupId: null,
        },
        {
          roleKey: "custom:role-9",
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: null,
        },
      ]);
    });

    /** @scenario "Migrated custom bindings retain their permission restrictions" */
    it.each([
      "ORGANIZATION",
      "TEAM",
      "PROJECT",
    ] as const)("collects the canonical custom key beside legacy ADMIN at %s scope", async (scopeType) => {
      const scopeIds = {
        ORGANIZATION: "org-1",
        TEAM: "team-1",
        PROJECT: "project-1",
      };
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          organizationUser: { findFirst: member() },
          grant: {
            findMany: vi.fn().mockResolvedValue([
              grantRow({
                roleKey: "custom:restricted",
                legacyRole: "ADMIN",
                scopeType,
                scopeId: scopeIds[scopeType],
              }),
            ]),
          },
        }),
      );
      const bindings = await repository.findUserBindings({
        userId: "alice",
        organizationId: "org-1",
      });
      const grants = {
        principal: { type: "user", id: "alice" } as const,
        organizationId: "org-1",
        organizationRole: "MEMBER" as const,
        isOrgMember: true,
        membershipDisabled: false,
        bindings,
        customRolePermissions: new Map([["restricted", ["traces:view"]]]),
      };
      const scope = {
        type: "project",
        id: "project-1",
        teamId: "team-1",
        organizationId: "org-1",
      } as const;
      const engine = new AuthzEngine();
      expect(
        engine.decide({ grants, permission: "traces:view", scope }).allowed,
      ).toBe(true);
      expect(
        engine.decide({ grants, permission: "project:delete", scope }).allowed,
      ).toBe(false);
      expect(
        engine.decide({
          grants: { ...grants, customRolePermissions: new Map() },
          permission: "traces:view",
          scope,
        }).allowed,
      ).toBe(false);
    });

    it("preserves member and viewer role keys", async () => {
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          organizationUser: { findFirst: member() },
          grant: {
            findMany: vi.fn().mockResolvedValue([
              grantRow({
                roleKey: "member",
                scopeType: "ORGANIZATION",
                scopeId: "org-1",
              }),
              grantRow({ roleKey: "viewer" }),
            ]),
          },
        }),
      );

      expect(
        (
          await repository.findUserBindings({
            userId: "alice",
            organizationId: "org-1",
          })
        ).map((binding) => binding.roleKey),
      ).toEqual(["member", "viewer"]);
    });

    describe("when the user has left the organization", () => {
      it("returns nothing, without reading a single grant", async () => {
        const findMany = vi.fn();
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
            grant: { findMany },
          }),
        );

        // The legacy query expresses this as a relation filter on the binding;
        // `Grant` has no relation to `User`, so the same fence is a membership
        // read. A grant naming a departed member confers nothing either way.
        expect(
          await repository.findUserBindings({
            userId: "alice",
            organizationId: "org-1",
          }),
        ).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
      });
    });

    describe("when a grant carries a key no decision reads yet", () => {
      it("skips lite-member, null and unrecognised keys rather than defaulting them", async () => {
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            organizationUser: { findFirst: member() },
            grant: {
              findMany: vi.fn().mockResolvedValue([
                grantRow({
                  id: "grant-resource",
                  principalType: "ANYONE",
                  principalId: null,
                  roleKey: null,
                  scopeType: "RESOURCE",
                  scopeId: "trace-1",
                  token: "share-token",
                  permission: "traces:view",
                  resourceKind: "TRACE",
                  projectId: "project-1",
                }),
                grantRow({
                  roleKey: "lite-member",
                  scopeType: "ORGANIZATION",
                  scopeId: "org-1",
                }),
                grantRow({ id: "grant-2", roleKey: null }),
                grantRow({
                  id: "grant-3",
                  roleKey: "future-key",
                  scopeType: "PROJECT",
                  scopeId: "proj-1",
                }),
                grantRow({
                  id: "grant-4",
                  roleKey: "admin",
                  scopeType: "TEAM",
                  scopeId: "team-2",
                }),
              ]),
            },
          }),
        );

        // Dormant head-only facts: stored so contract can make them
        // load-bearing, still served by the engine's membership inference
        // until then. Translating one here would change a decision the
        // cutover promised not to change.
        expect(
          await repository.findUserBindings({
            userId: "alice",
            organizationId: "org-1",
          }),
        ).toEqual([
          {
            roleKey: "admin",
            scopeType: "TEAM",
            scopeId: "team-2",
            viaGroupId: null,
          },
        ]);
      });
    });
  });

  describe("when findGroupBindings collects a group's grants", () => {
    it("expands the user's groups in this organization and stamps viaGroupId", async () => {
      const groupFindMany = vi
        .fn()
        .mockResolvedValue([{ groupId: "group-1" }, { groupId: "group-2" }]);
      const grantFindMany = vi.fn().mockResolvedValue([
        grantRow({
          principalType: "GROUP",
          principalId: "group-2",
          roleKey: "member",
          scopeType: "PROJECT",
          scopeId: "proj-1",
        }),
      ]);
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          organizationUser: { findFirst: member() },
          groupMembership: { findMany: groupFindMany },
          grant: { findMany: grantFindMany },
        }),
      );

      const bindings = await repository.findGroupBindings({
        userId: "alice",
        organizationId: "org-1",
      });

      expect(groupFindMany).toHaveBeenCalledWith({
        where: { userId: "alice", group: { organizationId: "org-1" } },
        select: { groupId: true },
      });
      expect(grantFindMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          principalType: "GROUP",
          principalId: { in: ["group-1", "group-2"] },
          scopeType: { in: ["ORGANIZATION", "TEAM", "PROJECT"] },
          revokedAt: null,
        },
        select: bindingGrantSelect,
      });
      expect(bindings).toEqual([
        {
          roleKey: "member",
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: "group-2",
        },
      ]);
    });

    describe("when the group member has left the organization", () => {
      it("returns nothing, because a GroupMembership row outlives the membership", async () => {
        const groupFindMany = vi.fn();
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
            groupMembership: { findMany: groupFindMany },
            grant: { findMany: vi.fn() },
          }),
        );

        expect(
          await repository.findGroupBindings({
            userId: "alice",
            organizationId: "org-1",
          }),
        ).toEqual([]);
        expect(groupFindMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("when findApiKeyBindings collects a key's grants", () => {
    it("reads the key's own grants with no membership gate", async () => {
      const findMany = vi.fn().mockResolvedValue([
        grantRow({
          principalType: "API_KEY",
          principalId: "key-1",
          roleKey: "viewer",
          scopeType: "PROJECT",
          scopeId: "proj-1",
        }),
      ]);
      const repository = new GrantsAuthzReadRepository(
        clientFor({ grant: { findMany } }),
      );

      const bindings = await repository.findApiKeyBindings({
        apiKeyId: "key-1",
        organizationId: "org-1",
      });

      // A key has no OrganizationUser row of its own; the owner's standing
      // enters as the §9 ceiling, computed elsewhere.
      expect(findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          principalType: "API_KEY",
          principalId: "key-1",
          scopeType: { in: ["ORGANIZATION", "TEAM", "PROJECT"] },
          revokedAt: null,
        },
        select: bindingGrantSelect,
      });
      expect(bindings).toEqual([
        {
          roleKey: "viewer",
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: null,
        },
      ]);
    });
  });

  describe("when findCustomRolePermissions resolves a principal's role", () => {
    describe("when the principal is a user", () => {
      it("fences on the organization and excludes every API-key system role", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const repository = new GrantsAuthzReadRepository(
          clientFor({ role: { findMany } }),
        );

        await repository.findCustomRolePermissions({
          organizationId: "org-1",
          principal: { type: "user", id: "alice" },
          customRoleIds: ["role-1", "role-2"],
        });

        expect(findMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["role-1", "role-2"] },
            organizationId: "org-1",
            kind: { not: "system_api_key" },
            deletedAt: null,
          },
          select: { id: true, permissions: true, kind: true },
        });
      });

      it("returns the stored permission payload unparsed", async () => {
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            role: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: "role-1",
                  permissions: ["traces:view"],
                  kind: "custom",
                },
              ]),
            },
          }),
        );

        expect(
          await repository.findCustomRolePermissions({
            organizationId: "org-1",
            principal: { type: "user", id: "alice" },
            customRoleIds: ["role-1"],
          }),
        ).toEqual([{ id: "role-1", permissions: ["traces:view"] }]);
      });
    });

    describe("when the principal is an API key", () => {
      it("allows a system role held by this key alone", async () => {
        const roleFindMany = vi.fn().mockResolvedValue([
          {
            id: "role-1",
            permissions: ["traces:view"],
            kind: "system_api_key",
          },
        ]);
        const grantFindMany = vi.fn().mockResolvedValue([
          grantRow({
            roleKey: "custom:role-1",
            principalType: "API_KEY",
            principalId: "key-1",
          }),
        ]);
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            role: { findMany: roleFindMany },
            grant: { findMany: grantFindMany },
          }),
        );

        const rows = await repository.findCustomRolePermissions({
          organizationId: "org-1",
          principal: { type: "apiKey", id: "key-1" },
          customRoleIds: ["role-1"],
        });

        expect(roleFindMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["role-1"] },
            organizationId: "org-1",
            deletedAt: null,
          },
          select: { id: true, permissions: true, kind: true },
        });
        expect(grantFindMany).toHaveBeenCalledWith({
          where: {
            organizationId: "org-1",
            roleKey: { in: ["custom:role-1"] },
            revokedAt: null,
          },
          select: bindingGrantSelect,
        });
        expect(rows).toEqual([{ id: "role-1", permissions: ["traces:view"] }]);
      });

      it("excludes a system role another principal also holds", async () => {
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            role: {
              findMany: vi
                .fn()
                .mockResolvedValue([
                  { id: "role-1", permissions: [], kind: "system_api_key" },
                ]),
            },
            grant: {
              findMany: vi.fn().mockResolvedValue([
                grantRow({
                  roleKey: "custom:role-1",
                  principalType: "API_KEY",
                  principalId: "key-1",
                }),
                grantRow({
                  id: "grant-2",
                  roleKey: "custom:role-1",
                  principalType: "USER",
                  principalId: "alice",
                }),
              ]),
            },
          }),
        );

        // The `every` half of the legacy predicate: a grant on the role that
        // is not this key's - a user assignment, or another key - means the
        // role was never this key's private one.
        expect(
          await repository.findCustomRolePermissions({
            organizationId: "org-1",
            principal: { type: "apiKey", id: "key-1" },
            customRoleIds: ["role-1"],
          }),
        ).toEqual([]);
      });

      describe("when a system role carries no grants at all", () => {
        it("excludes it, because `every` alone is vacuously true over nothing", async () => {
          const repository = new GrantsAuthzReadRepository(
            clientFor({
              role: {
                findMany: vi.fn().mockResolvedValue([
                  {
                    id: "orphan-role",
                    permissions: [],
                    kind: "system_api_key",
                  },
                ]),
              },
              grant: { findMany: vi.fn().mockResolvedValue([]) },
            }),
          );

          // The `some` half: a bindingless system role satisfied "every grant
          // is mine" for every key on the platform, so without it any key that
          // named such a role collected its permissions.
          expect(
            await repository.findCustomRolePermissions({
              organizationId: "org-1",
              principal: { type: "apiKey", id: "key-1" },
              customRoleIds: ["orphan-role"],
            }),
          ).toEqual([]);
        });
      });

      it("keeps ordinary custom roles beside the fenced system one", async () => {
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            role: {
              findMany: vi.fn().mockResolvedValue([
                { id: "role-1", permissions: ["traces:view"], kind: "custom" },
                {
                  id: "role-2",
                  permissions: ["secrets:manage"],
                  kind: "system_api_key",
                },
              ]),
            },
            grant: { findMany: vi.fn().mockResolvedValue([]) },
          }),
        );

        expect(
          await repository.findCustomRolePermissions({
            organizationId: "org-1",
            principal: { type: "apiKey", id: "key-1" },
            customRoleIds: ["role-1", "role-2"],
          }),
        ).toEqual([{ id: "role-1", permissions: ["traces:view"] }]);
      });
    });

    describe("when the principal references no custom role", () => {
      it("asks nothing of storage", async () => {
        const findMany = vi.fn();
        const repository = new GrantsAuthzReadRepository(
          clientFor({ role: { findMany } }),
        );

        expect(
          await repository.findCustomRolePermissions({
            organizationId: "org-1",
            principal: { type: "user", id: "alice" },
            customRoleIds: [],
          }),
        ).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("when findShareLinks resolves a share token", () => {
    const lineageStub = () =>
      vi
        .fn()
        .mockResolvedValue({ team: { id: "team-1", organizationId: "org-1" } });

    it("filters by presented token AND the resource links, organization-anchored", async () => {
      const grantFindMany = vi.fn().mockResolvedValue([]);
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          project: { findUnique: lineageStub() },
          grant: { findMany: grantFindMany },
          grantUsage: { findMany: vi.fn() },
        }),
      );

      await repository.findShareLinks({
        projectId: "proj-1",
        tokens: ["tok-1"],
        links: [
          { kind: "trace", id: "trace-1" },
          { kind: "thread", id: "thread-1" },
        ],
      });

      // Token possession is the gate, and it lives in the WHERE: returning
      // rows the request never presented would reopen trace-id guessing. The
      // organizationId is there because the tenancy guard demands it - Grant's
      // token bound admits one literal token, not a list.
      expect(grantFindMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          projectId: "proj-1",
          scopeType: "RESOURCE",
          token: { in: ["tok-1"] },
          revokedAt: null,
          OR: [
            { resourceKind: "TRACE", scopeId: "trace-1" },
            { resourceKind: "THREAD", scopeId: "thread-1" },
          ],
        },
        select: {
          id: true,
          principalType: true,
          resourceKind: true,
          scopeId: true,
          projectId: true,
          expiresAt: true,
          maxViews: true,
        },
      });
    });

    describe("when the caller already knows the organization", () => {
      it("skips resolving the project's lineage a second time", async () => {
        const lineageFindUnique = vi.fn();
        const grantFindMany = vi.fn().mockResolvedValue([]);
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            project: { findUnique: lineageFindUnique },
            grant: { findMany: grantFindMany },
            grantUsage: { findMany: vi.fn() },
          }),
        );

        await repository.findShareLinks({
          projectId: "proj-1",
          tokens: ["tok-1"],
          links: [{ kind: "trace", id: "trace-1" }],
          organizationId: "org-1",
        });

        expect(lineageFindUnique).not.toHaveBeenCalled();
        expect(grantFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ organizationId: "org-1" }),
          }),
        );
      });
    });

    it("maps each principal onto the share audience it stands for", async () => {
      const expiresAt = new Date("2026-01-01T00:00:00.000Z");
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          project: { findUnique: lineageStub() },
          grant: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: "grant-1",
                principalType: "ANYONE",
                resourceKind: "TRACE",
                scopeId: "trace-1",
                projectId: "proj-1",
                expiresAt,
                maxViews: 5,
              },
              {
                id: "grant-2",
                principalType: "ORGANIZATION",
                resourceKind: "THREAD",
                scopeId: "thread-1",
                projectId: "proj-1",
                expiresAt: null,
                maxViews: null,
              },
              {
                id: "grant-3",
                principalType: "PROJECT",
                resourceKind: "TRACE",
                scopeId: "trace-2",
                projectId: "proj-1",
                expiresAt: null,
                maxViews: null,
              },
            ]),
          },
          grantUsage: {
            findMany: vi
              .fn()
              .mockResolvedValue([{ grantId: "grant-1", viewCount: 3 }]),
          },
        }),
      );

      expect(
        await repository.findShareLinks({
          projectId: "proj-1",
          tokens: ["tok-1"],
          links: [{ kind: "trace", id: "trace-1" }],
        }),
      ).toEqual([
        {
          resourceType: "TRACE",
          resourceId: "trace-1",
          projectId: "proj-1",
          visibility: "PUBLIC",
          expiresAt,
          maxViews: 5,
          viewCount: 3,
        },
        {
          resourceType: "THREAD",
          resourceId: "thread-1",
          projectId: "proj-1",
          visibility: "ORGANIZATION",
          expiresAt: null,
          maxViews: null,
          viewCount: 0,
        },
        {
          resourceType: "TRACE",
          resourceId: "trace-2",
          projectId: "proj-1",
          visibility: "PROJECT",
          expiresAt: null,
          maxViews: null,
          viewCount: 0,
        },
      ]);
    });

    it("reads the view budget by grant id, since the fold never writes it", async () => {
      const usageFindMany = vi.fn().mockResolvedValue([]);
      const repository = new GrantsAuthzReadRepository(
        clientFor({
          project: { findUnique: lineageStub() },
          grant: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: "grant-1",
                principalType: "ANYONE",
                resourceKind: "TRACE",
                scopeId: "trace-1",
                projectId: "proj-1",
                expiresAt: null,
                maxViews: null,
              },
            ]),
          },
          grantUsage: { findMany: usageFindMany },
        }),
      );

      await repository.findShareLinks({
        projectId: "proj-1",
        tokens: ["tok-1"],
        links: [{ kind: "trace", id: "trace-1" }],
      });

      expect(usageFindMany).toHaveBeenCalledWith({
        // The organization bound alongside the ids: a grant-id list alone
        // is not a tenancy fence.
        where: { organizationId: "org-1", grantId: { in: ["grant-1"] } },
        select: { grantId: true, viewCount: true },
      });
    });

    describe("when a resource grant names an audience the legacy shim never held", () => {
      it("skips the row", async () => {
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            project: { findUnique: lineageStub() },
            grant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: "grant-1",
                  principalType: "USER",
                  resourceKind: "TRACE",
                  scopeId: "trace-1",
                  projectId: "proj-1",
                  expiresAt: null,
                  maxViews: null,
                },
              ]),
            },
            grantUsage: { findMany: vi.fn().mockResolvedValue([]) },
          }),
        );

        expect(
          await repository.findShareLinks({
            projectId: "proj-1",
            tokens: ["tok-1"],
            links: [{ kind: "trace", id: "trace-1" }],
          }),
        ).toEqual([]);
      });
    });

    describe("when the project is unknown", () => {
      it("returns nothing rather than reading grants unfenced", async () => {
        const grantFindMany = vi.fn();
        const repository = new GrantsAuthzReadRepository(
          clientFor({
            project: { findUnique: vi.fn().mockResolvedValue(null) },
            grant: { findMany: grantFindMany },
          }),
        );

        expect(
          await repository.findShareLinks({
            projectId: "proj-ghost",
            tokens: ["tok-1"],
            links: [{ kind: "trace", id: "trace-1" }],
          }),
        ).toEqual([]);
        expect(grantFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when the request presented no token", () => {
      it("asks nothing of storage", async () => {
        const findUnique = vi.fn();
        const repository = new GrantsAuthzReadRepository(
          clientFor({ project: { findUnique } }),
        );

        expect(
          await repository.findShareLinks({
            projectId: "proj-1",
            tokens: [],
            links: [{ kind: "trace", id: "trace-1" }],
          }),
        ).toEqual([]);
        expect(findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe("when findApiKeyOwner reads a key's owner", () => {
    it("distinguishes a service key from a key that is not there", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ userId: null })
        .mockResolvedValueOnce(null);
      const repository = new GrantsAuthzReadRepository(
        clientFor({ apiKey: { findUnique } }),
      );

      expect(await repository.findApiKeyOwner("service-key")).toEqual({
        userId: null,
      });
      expect(await repository.findApiKeyOwner("ghost")).toBeNull();
    });
  });

  describe("when findProjectLineage reads a project's lineage", () => {
    it("returns the owning team and organization, null for an unknown project", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({
          team: { id: "team-1", organizationId: "org-1" },
        })
        .mockResolvedValueOnce(null);
      const repository = new GrantsAuthzReadRepository(
        clientFor({ project: { findUnique } }),
      );

      expect(
        await repository.findProjectLineage({ projectId: "proj-1" }),
      ).toEqual({
        teamId: "team-1",
        organizationId: "org-1",
      });
      expect(
        await repository.findProjectLineage({ projectId: "proj-ghost" }),
      ).toBeNull();
    });
  });

  describe("when findTeamOrganization reads a team's organization", () => {
    it("returns the team's organization, null for an unknown team", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ organizationId: "org-1" })
        .mockResolvedValueOnce(null);
      const repository = new GrantsAuthzReadRepository(
        clientFor({ team: { findUnique } }),
      );

      expect(
        await repository.findTeamOrganization({ teamId: "team-1" }),
      ).toEqual({
        organizationId: "org-1",
      });
      expect(
        await repository.findTeamOrganization({ teamId: "team-ghost" }),
      ).toBeNull();
    });
  });
});
