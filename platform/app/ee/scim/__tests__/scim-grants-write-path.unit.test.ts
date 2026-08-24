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
 *     an unconditional MEMBER.
 *
 * With the flag off, every one of them is the previous behaviour, unchanged.
 */
import { OffboardIncompleteError } from "@langwatch/authz-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "~/env.mjs";
import type { PrismaClient, User } from "~/generated/prisma/client";
import { ScimService } from "../scim.service";

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
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(buildUser()),
      create: vi.fn().mockResolvedValue(buildUser()),
      update: vi.fn().mockResolvedValue(buildUser()),
    },
    organizationUser: {
      findUnique: vi.fn().mockResolvedValue({ userId: USER }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
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
    $transaction: vi
      .fn()
      .mockImplementation((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaClient;
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
        where: { connectionId: CONNECTION, userId: USER },
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

        // `deactivatedAt` is only ever written AFTER a proved-empty removal.
        expect(prisma.user.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("when somebody is pushed active again", () => {
    it("lifts the sign-in block and restores no access", async () => {
      await service.updateUser({
        id: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: true }],
        },
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { deactivatedAt: null },
      });
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
      beforeEach(() => {
        prisma.organizationUser.findUnique = vi.fn().mockResolvedValue(null);
        prisma.scimExternalId.findFirst = vi
          .fn()
          .mockResolvedValue({ externalId: "u-1" });
        prisma.user.findUnique = vi
          .fn()
          .mockResolvedValue(buildUser({ deactivatedAt: new Date() }));
      });

      // Not bound to "Coming back restores nothing on its own": that scenario
      // is tagged @integration, and asserting on a mocked Prisma proves the
      // CALLS were not made, not that nothing resolves in a real database.
      it("lets them sign in again and gives them nothing in the organization", async () => {
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
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: USER },
          data: { deactivatedAt: null },
        });
        // Nothing is put back: no membership, no grant, no role.
        expect(prisma.organizationUser.create).not.toHaveBeenCalled();
        expect(ledger.attachBindings).not.toHaveBeenCalled();
      });

      it("still answers not found for a push that is not a reactivation", async () => {
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

        expect(result).toMatchObject({ status: "404" });
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it("still answers not found once the connection has forgotten them", async () => {
        prisma.scimExternalId.findFirst = vi.fn().mockResolvedValue(null);

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
        create: { connectionId: CONNECTION, externalId: "u-1", userId: USER },
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
      prisma.roleBinding.findMany = vi
        .fn()
        .mockResolvedValueOnce([{ role: "ADMIN" }])
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
    });
  });

  describe("when a push aims at somebody another connection provisioned", () => {
    it("refuses and changes nothing about them", async () => {
      prisma.scimExternalId.findMany = vi
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

    expect(ledger.offboardMember).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      userId: USER,
      revokedGrantIds: [],
      actor: { type: "system", id: "system:scim" },
    });
    expect(prisma.organizationUser.delete).toHaveBeenCalled();
    expect(grants.offboard).not.toHaveBeenCalled();
  });

  it("leaves a push marking somebody inactive as the flag it was", async () => {
    await service.updateUser({
      id: USER,
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      patchRequest: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });

    expect(grants.offboard).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { deactivatedAt: expect.any(Date) },
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
