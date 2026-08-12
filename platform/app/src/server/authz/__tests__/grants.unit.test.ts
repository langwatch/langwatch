import type { PrismaClient } from "@prisma/client";
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
