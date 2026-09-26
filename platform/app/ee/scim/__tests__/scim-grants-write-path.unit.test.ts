import { OffboardIncompleteError } from "@langwatch/authz-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "~/env.mjs";
import type { PrismaClient, User } from "~/generated/prisma/client";

import { ScimService } from "../scim.service";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What changes when `SCIM_V2_GRANTS` is on (D08).
 *
 * Three things, and they are the whole deliverable at the service level:
 *
 *   - a deprovision goes through `GrantsService.offboard`, the SERVICE whose
 *     empty proof runs, rather than the ledger writer underneath it;
 *   - marking somebody inactive takes that identical path, so `active: false`
 *     stops being a flag that revokes nothing;
 *   - membership carries the role the directory's mapping asserts rather than
 *     an unconditional MEMBER, while the canonical group binding remains the
 *     only access fact on the grants path (no duplicate direct USER grant).
 *
 * With the flag off, every one of them is the previous compatibility behaviour,
 * unchanged, including its direct USER organization grant reconciliation.
 */
import { resourceStore } from "./scim-user-resource.fixture";

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

// The flag is validated once at module load, so `vi.stubEnv` would never
// reach it. The env object itself is the seam — the same shape
// `legacy-sso-string-writes.unit.test.ts` uses one flag over.
vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SCIM_V2_GRANTS: "off" } };
});

const envMock = env as unknown as { SCIM_V2_GRANTS: string };

const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  offboardMember: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

const ORGANIZATION = "org-1";
const CONNECTION = "conn-okta";
const USER = "user-1";

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: USER,
    name: "Alice Smith",
    email: "alice@acme.com",
    emailVerified: false,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    userHashKey: null,
    tracesExplorerTourDismissedAt: null,
    ...overrides,
  } as User;
}

function createMockPrisma() {
  const mock = {
    scimUserResource: resourceStore(),
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(buildUser()),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(buildUser()),
      update: vi.fn().mockResolvedValue(buildUser()),
    },
    organizationUser: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ userId: USER }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
    grant: { findMany: vi.fn().mockResolvedValue([]) },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    group: { findMany: vi.fn().mockResolvedValue([]) },
    ssoConnection: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; organizationId: string } }) =>
          where.id === "conn-okta" && where.organizationId === ORGANIZATION
            ? { replacesConnectionId: null, migrationPhase: null }
            : null,
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; organizationId: string };
        }) =>
          where.organizationId === ORGANIZATION
            ? where.id.in
                .filter((id) => id === "conn-entra")
                .map((id) => ({ id }))
            : [],
      ),
    },
    scimDirectoryUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    scimExternalId: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    session: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((operation: unknown) => {
    if (typeof operation === "function") return operation(mock);
    if (Array.isArray(operation)) return Promise.all(operation);
    throw new Error("unexpected transaction input");
  });
  return mock as unknown as PrismaClient;
}

function createGrants() {
  return {
    offboard: vi.fn().mockResolvedValue({
      removed: {},
      needsHumanDecision: { ownedApiKeys: [], personalTeams: [] },
    }),
  };
}

function createSyncLifecycle() {
  return {
    userPushed: vi.fn().mockResolvedValue(undefined),
    applyFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ScimService, on the grants write path", () => {
  let prisma: PrismaClient;
  let grants: ReturnType<typeof createGrants>;
  let syncLifecycle: ReturnType<typeof createSyncLifecycle>;
  let service: ScimService;

  beforeEach(() => {
    envMock.SCIM_V2_GRANTS = "on";
    ledger.offboardMember.mockReset().mockResolvedValue(undefined);
    ledger.attachBindings.mockReset().mockResolvedValue(undefined);
    prisma = createMockPrisma();
    grants = createGrants();
    syncLifecycle = createSyncLifecycle();
    service = ScimService.create({
      prisma,
      grants: grants as never,
      syncLifecycle: syncLifecycle as never,
    });
  });

  afterEach(() => {
    envMock.SCIM_V2_GRANTS = "off";
  });

  describe("when the directory deletes somebody", () => {
    it("removes their access through the service whose proof runs", async () => {
      await service.deleteUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });

      expect(grants.offboard).toHaveBeenCalledWith({
        actor: { type: "system", name: "scim" },
        userId: USER,
        organizationId: ORGANIZATION,
      });
      // The service's own transaction removes the memberships, so nothing is
      // left for the SCIM path to delete by hand.
      expect(prisma.organizationUser.delete).not.toHaveBeenCalled();
      expect(ledger.offboardMember).not.toHaveBeenCalled();
    });

    it("forgets that connection's directory identity for them", async () => {
      await service.deleteUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });

      expect(prisma.scimExternalId.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          userId: USER,
        },
      });
    });
  });

  describe("when the directory pushes somebody inactive", () => {
    it("removes their access with the same proof a deletion carries", async () => {
      await service.updateUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: false }],
        },
      });

      expect(grants.offboard).toHaveBeenCalledWith({
        actor: { type: "system", name: "scim" },
        userId: USER,
        organizationId: ORGANIZATION,
      });
    });

    it("takes the same path when active arrives inside a value object", async () => {
      await service.updateUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", value: { active: false } }],
        },
      });

      expect(grants.offboard).toHaveBeenCalled();
    });

    it("takes the same path on a PUT that restates them as inactive", async () => {
      prisma.user.update = vi
        .fn()
        .mockResolvedValue(buildUser({ deactivatedAt: null }));

      await service.replaceUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          active: false,
        },
      });

      expect(grants.offboard).toHaveBeenCalled();
    });

    describe("when the proof still finds something resolving", () => {
      beforeEach(() => {
        grants.offboard = vi
          .fn()
          .mockRejectedValue(new OffboardIncompleteError({}));
      });

      /** @scenario A removal that cannot prove itself empty fails loudly */
      /** @scenario A deactivate that cannot be applied is as visible as any other failure */
      it("refuses, and never marks them inactive while they still hold access", async () => {
        await expect(
          service.updateUser({
            id: USER,
            organizationId: ORGANIZATION,
            connectionId: CONNECTION,
            patchRequest: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
              Operations: [{ op: "replace", path: "active", value: false }],
            },
          }),
        ).rejects.toMatchObject({ code: "offboard_incomplete" });

        // A failed removal leaves both the shared account and tenant resource unchanged.
        expect(prisma.user.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("when somebody is pushed active again", () => {
    it("reactivates the directory resource and restores no access", async () => {
      await service.updateUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: true }],
        },
      });

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.scimUserResource.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ active: true }),
        }),
      );
      expect(ledger.attachBindings).not.toHaveBeenCalled();
    });

    /**
     * The membership row goes with everything else in a proved deprovision —
     * that is what makes the proof pass — so a reactivating push arrives for
     * somebody the update path can no longer find. Answering 404 would leave
     * the sign-in block up forever, which is the opposite of what the spec
     * asks for.
     */
    describe("given the deprovision already removed their membership", () => {
      beforeEach(async () => {
        await prisma.scimUserResource.upsert({
          where: {
            organizationId_userId: {
              organizationId: ORGANIZATION,
              userId: USER,
            },
          },
          create: {
            organizationId: ORGANIZATION,
            userId: USER,
            userName: "alice@acme.com",
            name: "Alice",
            active: false,
          },
          update: { active: false },
        });
        prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
        prisma.scimDirectoryUser.findUnique = vi
          .fn()
          .mockResolvedValue({ connectionId: CONNECTION, userId: USER });
        prisma.user.findUnique = vi
          .fn()
          .mockResolvedValue(buildUser({ deactivatedAt: new Date() }));
      });

      // Not bound to "Coming back restores nothing on its own": that scenario
      // is tagged @integration, and asserting on a mocked Prisma proves the
      // CALLS were not made, not that nothing resolves in a real database.
      it("reactivates only the tenant resource and gives them nothing in the organization", async () => {
        const result = await service.updateUser({
          id: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [{ op: "replace", path: "active", value: true }],
          },
        });

        expect(result).toMatchObject({ id: USER });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.scimUserResource.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ active: true }),
          }),
        );
        // Nothing is put back: no membership, no grant, no role.
        expect(prisma.organizationUser.create).not.toHaveBeenCalled();
        expect(ledger.attachBindings).not.toHaveBeenCalled();
      });

      it("updates an inactive resource profile without restoring access", async () => {
        const result = await service.updateUser({
          id: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              { op: "replace", value: { userName: "alice@acme.com" } },
            ],
          },
        });

        expect(result).toMatchObject({
          id: USER,
          active: false,
          userName: "alice@acme.com",
        });
        expect(prisma.organizationUser.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it("still answers not found once the connection has forgotten them", async () => {
        prisma.scimDirectoryUser.findUnique = vi.fn().mockResolvedValue(null);
        prisma.scimUserResource.findUnique = vi.fn().mockResolvedValue(null);

        const result = await service.updateUser({
          id: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [{ op: "replace", path: "active", value: true }],
          },
        });

        expect(result).toMatchObject({ status: "404" });
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it("takes the same path on a PUT restating them as active", async () => {
        const result = await service.replaceUser({
          id: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.com",
            active: true,
          },
        });

        expect(result).toMatchObject({ id: USER });
        expect(prisma.organizationUser.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("when a push creates a member the directory has mapped no role for", () => {
    /** @scenario Membership is no longer a fixed role written beside the grant */
    it("creates no organization-scoped grant, because nothing asserted one", async () => {
      prisma.user.findUnique = vi.fn().mockResolvedValue(null);
      prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
      prisma.user.create = vi.fn().mockResolvedValue(buildUser());

      await service.createUser({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: "u-1",
        },
      });

      expect(ledger.attachBindings).not.toHaveBeenCalled();
      const created = (
        prisma.organizationUser.create as ReturnType<typeof vi.fn>
      ).mock.calls[0]![0];
      expect(created.data.role).toBe("MEMBER");
    });

    it("remembers who the directory means by that identifier", async () => {
      prisma.user.findUnique = vi.fn().mockResolvedValue(null);
      prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
      prisma.user.create = vi.fn().mockResolvedValue(buildUser());

      await service.createUser({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: "u-1",
        },
      });

      expect(prisma.scimExternalId.upsert).toHaveBeenCalledWith({
        where: {
          connectionId_externalId: {
            connectionId: CONNECTION,
            externalId: "u-1",
          },
        },
        create: {
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          externalId: "u-1",
          userId: USER,
        },
        update: { userId: USER },
      });
    });

    it("states the push on the connection's own history", async () => {
      prisma.user.findUnique = vi.fn().mockResolvedValue(null);
      prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
      prisma.user.create = vi.fn().mockResolvedValue(buildUser());

      await service.createUser({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: "u-1",
        },
      });

      expect(syncLifecycle.userPushed).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        userId: USER,
        externalId: "u-1",
        op: "create",
      });
    });
  });

  describe("when the directory's mapping asserts a role", () => {
    beforeEach(() => {
      prisma.user.findUnique = vi.fn().mockResolvedValue(null);
      prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
      prisma.user.create = vi.fn().mockResolvedValue(buildUser());
      // One mapped group carrying ADMIN at the organization.
      prisma.groupMembership.findMany = vi
        .fn()
        .mockResolvedValue([{ groupId: "group-1" }]);
      prisma.group.findMany = vi
        .fn()
        .mockResolvedValue([
          { id: "group-1", name: "Administrators", scimSource: CONNECTION },
        ]);
      prisma.grant.findMany = vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "group-grant-1",
            organizationId: ORGANIZATION,
            principalType: "GROUP",
            principalId: "group-1",
            roleKey: "admin",
            legacyRole: null,
            source: "migration",
            scopeType: "ORGANIZATION",
            scopeId: ORGANIZATION,
            token: null,
            permission: null,
            resourceKind: null,
            projectId: null,
            createdByUserId: null,
            expiresAt: null,
            maxViews: null,
            occurredAt: new Date("2024-01-01T00:00:00Z"),
            updatedAt: new Date("2024-01-01T00:00:00Z"),
          },
        ])
        .mockResolvedValue([]);
    });

    /** @scenario Membership is no longer a fixed role written beside the grant */
    it("gives the membership the role the mapping asserts, not a fixed MEMBER", async () => {
      await service.createUser({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: "u-1",
        },
      });

      const created = (
        prisma.organizationUser.create as ReturnType<typeof vi.fn>
      ).mock.calls[0]![0];
      expect(created.data.role).toBe("ADMIN");
      expect(prisma.groupMembership.findMany).toHaveBeenCalledWith({
        where: {
          userId: USER,
          group: { organizationId: ORGANIZATION, scimSource: { not: null } },
        },
        select: { groupId: true },
      });
      expect(prisma.roleBinding.findMany).not.toHaveBeenCalled();
      // The group binding is already the canonical access fact. The grants path
      // must not mint a second direct USER organization grant.
      expect(ledger.attachBindings).not.toHaveBeenCalled();
    });

    it("recognizes a canonical grant even when the compatibility row is absent", async () => {
      prisma.grant.findMany = vi.fn().mockResolvedValue([
        {
          id: "grant-1",
          organizationId: ORGANIZATION,
          principalType: "USER",
          principalId: USER,
          roleKey: "admin",
          legacyRole: null,
          source: "migration",
          scopeType: "ORGANIZATION",
          scopeId: ORGANIZATION,
          token: null,
          permission: null,
          resourceKind: null,
          projectId: null,
          createdByUserId: null,
          expiresAt: null,
          maxViews: null,
          occurredAt: new Date("2024-01-01T00:00:00Z"),
          createdAt: new Date("2024-01-01T00:00:00Z"),
          updatedAt: new Date("2024-01-01T00:00:00Z"),
          revokedAt: null,
          revokedReason: null,
        },
      ]);

      await service.createUser({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: "u-1",
        },
      });

      expect(ledger.attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when a push aims at somebody another connection provisioned", () => {
    it("refuses and changes nothing about them", async () => {
      prisma.scimDirectoryUser.findMany = vi
        .fn()
        .mockResolvedValue([{ connectionId: "conn-entra" }]);

      await expect(
        service.deleteUser({
          id: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
        }),
      ).rejects.toMatchObject({
        code: "scim_write_outside_connection",
        httpStatus: 403,
      });

      expect(grants.offboard).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

describe("ScimService, with the grants flag off", () => {
  let prisma: PrismaClient;
  let grants: ReturnType<typeof createGrants>;
  let service: ScimService;

  beforeEach(() => {
    envMock.SCIM_V2_GRANTS = "off";
    ledger.offboardMember.mockReset().mockResolvedValue(undefined);
    ledger.attachBindings.mockReset().mockResolvedValue(undefined);
    prisma = createMockPrisma();
    grants = createGrants();
    service = ScimService.create({
      prisma,
      grants: grants as never,
      syncLifecycle: createSyncLifecycle() as never,
    });
  });

  afterEach(() => {
    envMock.SCIM_V2_GRANTS = "off";
  });

  /** @scenario With the flag off the previous write path answers exactly as before */
  it("deletes through the ledger writer and the membership row, as it did before", async () => {
    await service.deleteUser({
      id: USER,
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
    });

    expect(ledger.revokeBindingsWhere).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      where: { userId: USER },
      actor: { type: "system", id: "system:scim" },
      reason: "offboarded by the identity provider",
    });
    expect(prisma.organizationUser.delete).toHaveBeenCalled();
    expect(grants.offboard).not.toHaveBeenCalled();
  });

  /** @scenario A leaver loses their access however membership is being written */
  it("revokes through the previous write path, as a deletion with the flag off does", async () => {
    await service.updateUser({
      id: USER,
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      patchRequest: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });

    // The SERVICE and its empty proof are what the flag turns off, and they
    // stay off. This is the half the previous title claimed was the whole.
    expect(grants.offboard).not.toHaveBeenCalled();

    // The REVOCATION is not what the flag turns off. Without this branch a
    // push marking somebody inactive left the membership row, the role grant
    // and the seat exactly where they were, and the change list - which reads
    // revoked grants - recorded nothing, so a leaver was invisible on the
    // audit surface on the path real directories actually use.
    expect(ledger.revokeBindingsWhere).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      where: { userId: USER },
      actor: { type: "system", id: "system:scim" },
      reason: "offboarded by the identity provider",
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.scimUserResource.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ active: false }),
      }),
    );

    expect(prisma.organizationUser.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER, organizationId: ORGANIZATION },
    });
  });

  it("still asserts an unconditional MEMBER grant, as it did before", async () => {
    prisma.user.findUnique = vi.fn().mockResolvedValue(null);
    prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
    prisma.user.create = vi.fn().mockResolvedValue(buildUser());

    await service.createUser({
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "alice@acme.com",
      },
    });

    expect(ledger.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "scim",
        bindings: [expect.objectContaining({ role: "MEMBER" })],
      }),
    );
  });
});
