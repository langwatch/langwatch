import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GrantsService,
  GrantValidationError,
  OffboardIncompleteError,
} from "../grants";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
  getAuthzEpoch: vi.fn().mockResolvedValue(null),
}));
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@langwatch/ksuid", () => ({
  generate: () => ({ toString: () => "rb_test_ksuid" }),
}));

import { auditLog } from "@ee/audit-log/auditLog";
import { bumpAuthzEpoch } from "../epoch";

const ORG = "org-1";
const TEAM = "team-1";

type PrismaStub = {
  roleBinding: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  customRole: { findUnique: ReturnType<typeof vi.fn> };
  team: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  project: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  apiKey: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function makePrisma(overrides: Partial<PrismaStub> = {}): PrismaStub {
  return {
    roleBinding: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "rb-1", organizationId: ORG }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customRole: {
      findUnique: vi.fn().mockResolvedValue({ organizationId: ORG }),
    },
    team: {
      findUnique: vi.fn().mockResolvedValue({ organizationId: ORG }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    project: { findUnique: vi.fn().mockResolvedValue(null) },
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: "dave@acme.test" }),
    },
    apiKey: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
    ...overrides,
  };
}

const actor = { userId: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GrantsService.attach", () => {
  describe("when attaching a built-in role at team scope", () => {
    it("creates the binding row and bumps the org epoch", async () => {
      const prisma = makePrisma();
      const service = new GrantsService(prisma as unknown as PrismaClient);

      const result = await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { builtin: "VIEWER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
      });

      expect(result.bindingId).toBe("rb_test_ksuid");
      expect(prisma.roleBinding.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          scopeType: "TEAM",
          scopeId: TEAM,
          role: "VIEWER",
          customRoleId: null,
          userId: "alice",
          groupId: null,
          apiKeyId: null,
        }),
      });
      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.attach" }),
      );
    });
  });

  describe("when the custom role belongs to another organization", () => {
    it("rejects the attach", async () => {
      const prisma = makePrisma();
      prisma.customRole.findUnique.mockResolvedValue({
        organizationId: "org-other",
      });
      const service = new GrantsService(prisma as unknown as PrismaClient);

      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "alice" },
          role: { customRoleId: "cr-foreign" },
          where: { type: "organization", id: ORG },
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
      expect(prisma.roleBinding.create).not.toHaveBeenCalled();
    });
  });

  describe("when the team is not in the target organization", () => {
    it("rejects the attach", async () => {
      const prisma = makePrisma();
      prisma.team.findUnique.mockResolvedValue({
        organizationId: "org-other",
      });
      const service = new GrantsService(prisma as unknown as PrismaClient);

      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "alice" },
          role: { builtin: "MEMBER" },
          where: { type: "team", id: TEAM, organizationId: ORG },
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });
  });

  describe("when the scope already holds an identical binding", () => {
    /** @scenario "Attaching a duplicate role binding is rejected with a named error" */
    it("names the duplicate instead of leaking a raw P2002", async () => {
      const prisma = makePrisma();
      prisma.roleBinding.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
      const service = new GrantsService(prisma as unknown as PrismaClient);
      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "user-1" },
          role: { builtin: "MEMBER" },
          where: { type: "team", id: TEAM, organizationId: ORG },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(bumpAuthzEpoch).not.toHaveBeenCalled();
    });
  });
});

describe("GrantsService.revoke", () => {
  describe("when revoking an existing binding", () => {
    /** @scenario "Revoking a binding takes effect on the caller's next request" */
    it("deletes the row and bumps the epoch so the next check recollects", async () => {
      const prisma = makePrisma();
      const service = new GrantsService(prisma as unknown as PrismaClient);
      await service.revoke({ actor, bindingId: "rb-1" });
      expect(prisma.roleBinding.delete).toHaveBeenCalledWith({
        where: { id: "rb-1" },
      });
      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.revoke" }),
      );
    });
  });
});

describe("GrantsService.update", () => {
  describe("when the role change collides with a sibling binding", () => {
    it("names the duplicate instead of leaking a raw P2002", async () => {
      const prisma = makePrisma();
      prisma.roleBinding.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
      const service = new GrantsService(prisma as unknown as PrismaClient);
      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          role: { builtin: "MEMBER" },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(bumpAuthzEpoch).not.toHaveBeenCalled();
    });
  });

  describe("when re-pointing at another organization's custom role", () => {
    /** @scenario "A role binding can never reference another organization's custom role" */
    it("rejects with the same tenancy rule as attach", async () => {
      const prisma = makePrisma();
      prisma.customRole.findUnique.mockResolvedValue({
        organizationId: "org-other",
      });
      const service = new GrantsService(prisma as unknown as PrismaClient);
      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          role: { customRoleId: "cr-foreign" },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(prisma.roleBinding.update).not.toHaveBeenCalled();
    });
  });
});

describe("GrantsService.replace", () => {
  describe("when narrowing an org grant to a team grant", () => {
    /** @scenario "Replacing a grant is one atomic swap" */
    it("deletes and re-creates inside one transaction, with one audit record", async () => {
      const prisma = makePrisma();
      const tx = {
        roleBinding: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({}),
        },
      };
      prisma.$transaction.mockImplementation(
        async (fn: (handle: unknown) => Promise<unknown>) => fn(tx),
      );
      const service = new GrantsService(prisma as unknown as PrismaClient);
      const result = await service.replace({
        actor,
        who: { type: "user", id: "user-1" },
        from: { type: "organization", id: ORG },
        to: { type: "team", id: TEAM, organizationId: ORG },
        role: { builtin: "MEMBER" },
      });
      expect(result.bindingId).toBe("rb_test_ksuid");
      expect(tx.roleBinding.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.roleBinding.create).toHaveBeenCalledTimes(1);
      expect(prisma.roleBinding.deleteMany).not.toHaveBeenCalled();
      expect(prisma.roleBinding.create).not.toHaveBeenCalled();
      expect(auditLog).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.replace" }),
      );
      expect(bumpAuthzEpoch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GrantsService.offboard", () => {
  function makeTx({ stillMember = false } = {}) {
    return {
      roleBinding: {
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      groupMembership: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      teamUser: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      organizationUser: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi
          .fn()
          .mockResolvedValue(stillMember ? { role: "MEMBER" } : null),
      },
      organizationInvite: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customRole: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  describe("when every grant source deletes cleanly", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("returns the removal counts, the manifest, and bumps the epoch", async () => {
      const tx = makeTx();
      const prisma = makePrisma({
        $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
          callback(tx),
        ),
      });
      prisma.apiKey.findMany.mockResolvedValue([
        { id: "key-1", name: "dave ci key" },
      ]);
      prisma.team.findMany.mockResolvedValue([
        { id: "pt-1", name: "Dave's workspace" },
      ]);
      const service = new GrantsService(prisma as unknown as PrismaClient);

      const result = await service.offboard({
        actor,
        userId: "dave",
        organizationId: ORG,
      });

      expect(result.removed).toEqual({
        bindings: 3,
        groupMemberships: 2,
        legacyTeamMemberships: 1,
        pendingInvites: 1,
        organizationMembership: true,
      });
      expect(result.needsHumanDecision.ownedApiKeys).toEqual([
        { id: "key-1", name: "dave ci key" },
      ]);
      expect(result.needsHumanDecision.personalTeams).toEqual([
        { id: "pt-1", name: "Dave's workspace" },
      ]);
      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.offboard" }),
      );
    });
  });

  describe("when something still resolves after the deletes", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("throws and rolls the transaction back (the proof step)", async () => {
      const tx = makeTx({ stillMember: true });
      const prisma = makePrisma({
        $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
          callback(tx),
        ),
      });
      const service = new GrantsService(prisma as unknown as PrismaClient);

      await expect(
        service.offboard({ actor, userId: "dave", organizationId: ORG }),
      ).rejects.toBeInstanceOf(OffboardIncompleteError);
      expect(bumpAuthzEpoch).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });
  });
});
