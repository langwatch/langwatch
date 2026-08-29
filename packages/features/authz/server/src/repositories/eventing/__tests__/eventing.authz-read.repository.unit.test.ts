import { describe, expect, it, vi } from "vitest";
import type { AuthzDatabase } from "../../authz-read.repository";
import { EventingAuthzReadRepository } from "../eventing.authz-read.repository";

/**
 * The grants-head adapter's contract with Prisma, the mirror of
 * authz-read.prisma.repository.unit.test.ts: the same questions, asked of
 * `Grant` / `Role` / `GrantUsage`. What matters here is that the answers stay
 * the ones the legacy heads gave - every binding read fenced on CURRENT
 * organization membership, an API key's private role staying with the key it
 * was minted for, share reads keyed on the presented tokens - and that the
 * facts a cut-over organization stores but does not yet act on (lite-member
 * and friends) are skipped rather than translated into a decision.
 */
const clientFor = (models: Record<string, unknown>) => models as unknown as AuthzDatabase;

const member = () => vi.fn().mockResolvedValue({ userId: "alice" }) as ReturnType<typeof vi.fn>;

describe("EventingAuthzReadRepository", () => {
  describe("when tryFindOrganizationMembership reads the membership row", () => {
    it("reads the membership row, which the ledger never projected", async () => {
      const findFirst = vi.fn().mockResolvedValue({ role: "ADMIN", disabledAt: null });
      const repository = EventingAuthzReadRepository.create(
        clientFor({ organizationUser: { findFirst } }),
      );

      expect(
        await repository.tryFindOrganizationMembership({
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
      const repository = EventingAuthzReadRepository.create(
        clientFor({
          organizationUser: {
            findFirst: vi.fn().mockResolvedValue({ role: "MEMBER", disabledAt: new Date() }),
          },
        }),
      );

      expect(
        await repository.tryFindOrganizationMembership({
          userId: "alice",
          organizationId: "org-1",
        }),
      ).toEqual({ role: "MEMBER", disabled: true });
    });
  });

  describe("when findUserBindings collects a user's grants", () => {
    it("reads the user's own grants at the three binding scopes", async () => {
      const findMany = vi.fn().mockResolvedValue([
        { roleKey: "admin", scopeType: "TEAM", scopeId: "team-1" },
        {
          roleKey: "custom:role-9",
          scopeType: "PROJECT",
          scopeId: "proj-1",
        },
      ]);
      const repository = EventingAuthzReadRepository.create(
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
        select: { roleKey: true, scopeType: true, scopeId: true },
      });
      expect(bindings).toEqual([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team-1",
          viaGroupId: null,
        },
        {
          role: "CUSTOM",
          customRoleId: "role-9",
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: null,
        },
      ]);
    });

    it("translates member and viewer keys onto their legacy roles", async () => {
      const repository = EventingAuthzReadRepository.create(
        clientFor({
          organizationUser: { findFirst: member() },
          grant: {
            findMany: vi.fn().mockResolvedValue([
              {
                roleKey: "member",
                scopeType: "ORGANIZATION",
                scopeId: "org-1",
              },
              { roleKey: "viewer", scopeType: "TEAM", scopeId: "team-1" },
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
        ).map((binding) => binding.role),
      ).toEqual(["MEMBER", "VIEWER"]);
    });

    describe("when the user has left the organization", () => {
      it("returns nothing, without reading a single grant", async () => {
        const findMany = vi.fn();
        const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(
          clientFor({
            organizationUser: { findFirst: member() },
            grant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  roleKey: "lite-member",
                  scopeType: "ORGANIZATION",
                  scopeId: "org-1",
                },
                { roleKey: null, scopeType: "TEAM", scopeId: "team-1" },
                {
                  roleKey: "future-key",
                  scopeType: "PROJECT",
                  scopeId: "proj-1",
                },
                { roleKey: "admin", scopeType: "TEAM", scopeId: "team-2" },
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
            role: "ADMIN",
            customRoleId: null,
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
        {
          roleKey: "member",
          scopeType: "PROJECT",
          scopeId: "proj-1",
          principalId: "group-2",
        },
      ]);
      const repository = EventingAuthzReadRepository.create(
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
        select: {
          roleKey: true,
          scopeType: true,
          scopeId: true,
          principalId: true,
        },
      });
      expect(bindings).toEqual([
        {
          role: "MEMBER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: "group-2",
        },
      ]);
    });

    describe("when the group member has left the organization", () => {
      it("returns nothing, because a GroupMembership row outlives the membership", async () => {
        const groupFindMany = vi.fn();
        const repository = EventingAuthzReadRepository.create(
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
      const findMany = vi
        .fn()
        .mockResolvedValue([{ roleKey: "viewer", scopeType: "PROJECT", scopeId: "proj-1" }]);
      const repository = EventingAuthzReadRepository.create(clientFor({ grant: { findMany } }));

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
        select: { roleKey: true, scopeType: true, scopeId: true },
      });
      expect(bindings).toEqual([
        {
          role: "VIEWER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: null,
        },
      ]);
    });
  });

  describe("when findLegacyTeamMemberships reads the legacy team rows", () => {
    it("reads the same TeamUser rows as the legacy repository, tenancy-fenced", async () => {
      // Deliberately NOT empty for a cut-over organization: the rows live
      // until contract deletes them, and the engine's org-level union quirk
      // must keep inferring from them identically over both heads (the
      // dormant-fact principle) - an empty answer here made the two readers
      // disagree at organization scope for every ordinary member.
      const findMany = vi.fn().mockResolvedValue([
        {
          teamId: "team-1",
          role: "MEMBER",
          assignedRoleId: null,
          team: { isPersonal: false },
        },
      ]);
      const repository = EventingAuthzReadRepository.create(clientFor({ teamUser: { findMany } }));

      expect(
        await repository.findLegacyTeamMemberships({
          userId: "alice",
          organizationId: "org-1",
        }),
      ).toEqual([
        {
          teamId: "team-1",
          role: "MEMBER",
          customRoleId: null,
          isPersonal: false,
        },
      ]);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          userId: "alice",
          team: {
            organizationId: "org-1",
            organization: {
              members: { some: { userId: "alice", disabledAt: null } },
            },
          },
        },
        select: {
          teamId: true,
          role: true,
          assignedRoleId: true,
          team: { select: { isPersonal: true } },
        },
      });
    });
  });

  describe("when findCustomRolePermissions resolves a principal's role", () => {
    describe("when the principal is a user", () => {
      it("fences on the organization and excludes every API-key system role", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const repository = EventingAuthzReadRepository.create(clientFor({ role: { findMany } }));

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
        const repository = EventingAuthzReadRepository.create(
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
          {
            roleKey: "custom:role-1",
            principalType: "API_KEY",
            principalId: "key-1",
          },
        ]);
        const repository = EventingAuthzReadRepository.create(
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
          select: { roleKey: true, principalType: true, principalId: true },
        });
        expect(rows).toEqual([{ id: "role-1", permissions: ["traces:view"] }]);
      });

      it("excludes a system role another principal also holds", async () => {
        const repository = EventingAuthzReadRepository.create(
          clientFor({
            role: {
              findMany: vi
                .fn()
                .mockResolvedValue([{ id: "role-1", permissions: [], kind: "system_api_key" }]),
            },
            grant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  roleKey: "custom:role-1",
                  principalType: "API_KEY",
                  principalId: "key-1",
                },
                {
                  roleKey: "custom:role-1",
                  principalType: "USER",
                  principalId: "alice",
                },
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
          const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(clientFor({ role: { findMany } }));

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
      vi.fn().mockResolvedValue({ team: { id: "team-1", organizationId: "org-1" } });

    it("filters by presented token AND the resource links, organization-anchored", async () => {
      const grantFindMany = vi.fn().mockResolvedValue([]);
      const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(
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
      const repository = EventingAuthzReadRepository.create(
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
            findMany: vi.fn().mockResolvedValue([{ grantId: "grant-1", viewCount: 3 }]),
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
      const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(
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
        const repository = EventingAuthzReadRepository.create(
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

  describe("when tryFindApiKeyOwner reads a key's owner", () => {
    it("distinguishes a service key from a key that is not there", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ userId: null })
        .mockResolvedValueOnce(null);
      const repository = EventingAuthzReadRepository.create(clientFor({ apiKey: { findUnique } }));

      expect(await repository.tryFindApiKeyOwner("service-key")).toEqual({
        userId: null,
      });
      expect(await repository.tryFindApiKeyOwner("ghost")).toBeNull();
    });
  });

  describe("when tryFindProjectLineage reads a project's lineage", () => {
    it("returns the owning team and organization, null for an unknown project", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({
          team: { id: "team-1", organizationId: "org-1" },
        })
        .mockResolvedValueOnce(null);
      const repository = EventingAuthzReadRepository.create(clientFor({ project: { findUnique } }));

      expect(await repository.tryFindProjectLineage({ projectId: "proj-1" })).toEqual({
        teamId: "team-1",
        organizationId: "org-1",
      });
      expect(await repository.tryFindProjectLineage({ projectId: "proj-ghost" })).toBeNull();
    });
  });

  describe("when tryFindTeamOrganization reads a team's organization", () => {
    it("returns the team's organization, null for an unknown team", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ organizationId: "org-1" })
        .mockResolvedValueOnce(null);
      const repository = EventingAuthzReadRepository.create(clientFor({ team: { findUnique } }));

      expect(await repository.tryFindTeamOrganization({ teamId: "team-1" })).toEqual({
        organizationId: "org-1",
      });
      expect(await repository.tryFindTeamOrganization({ teamId: "team-ghost" })).toBeNull();
    });
  });
});
