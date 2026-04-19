import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  // VK crypto requires a pepper — set a 32-byte value for the test suite so
  // mintVirtualKeySecret + hashVirtualKeySecret don't throw during tests.
  process.env.LW_VIRTUAL_KEY_PEPPER =
    process.env.LW_VIRTUAL_KEY_PEPPER ?? "unit-test-pepper-32-bytes-exactly!";
});

import { GatewayAuditLogRepository } from "../auditLog.repository";
import { ChangeEventRepository } from "../changeEvent.repository";
import { VirtualKeyService } from "../virtualKey.service";
import {
  VirtualKeyRepository,
  type VirtualKeyWithChain,
} from "../virtualKey.repository";

/**
 * Unit tests for VirtualKeyService. The service owns a lot of write-path
 * invariants (secret minting, revision-bump, config merging, revoked-key
 * guards, cross-project credential isolation). These tests lock in the
 * behaviour that would be easy to regress silently.
 *
 * We inject mock repositories + prisma directly via the constructor rather
 * than using `VirtualKeyService.create(prisma)`, so the tests don't need to
 * stub Prisma itself for every operation.
 */

function stubVkRow(overrides: Partial<VirtualKeyWithChain> = {}): VirtualKeyWithChain {
  return {
    id: "vk_01",
    projectId: "proj_01",
    name: "prod-openai",
    description: null,
    displayPrefix: "lw_live_abc",
    hashedSecret: "HASHED_CURRENT",
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    environment: "LIVE",
    status: "ACTIVE",
    principalUserId: null,
    config: {},
    revision: 1n,
    lastUsedAt: null,
    revokedAt: null,
    revokedById: null,
    createdById: "user_01",
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-01"),
    providerCredentials: [
      { virtualKeyId: "vk_01", providerCredentialId: "gpc_01", priority: 0 } as any,
    ],
    ...overrides,
  } as unknown as VirtualKeyWithChain;
}

type Mocks = {
  prisma: PrismaClient;
  repository: VirtualKeyRepository;
  changeEvents: ChangeEventRepository;
  auditLog: GatewayAuditLogRepository;
  service: VirtualKeyService;
  findByIdMock: ReturnType<typeof vi.fn>;
  createMock: ReturnType<typeof vi.fn>;
  replaceChainMock: ReturnType<typeof vi.fn>;
  rotateSecretMock: ReturnType<typeof vi.fn>;
  revokeMock: ReturnType<typeof vi.fn>;
  auditAppend: ReturnType<typeof vi.fn>;
  changeAppend: ReturnType<typeof vi.fn>;
  providerCount: ReturnType<typeof vi.fn>;
  vkUpdateMock: ReturnType<typeof vi.fn>;
};

function makeService(opts: {
  existing?: VirtualKeyWithChain | null;
  providerCredentialCount?: number;
  createReturn?: VirtualKeyWithChain;
  updateReturn?: VirtualKeyWithChain;
  rotateReturn?: VirtualKeyWithChain;
  revokeReturn?: VirtualKeyWithChain;
} = {}): Mocks {
  const existing = opts.existing === undefined ? stubVkRow() : opts.existing;
  const createReturn = opts.createReturn ?? stubVkRow();
  const updateReturn = opts.updateReturn ?? stubVkRow({ revision: 2n });
  const rotateReturn = opts.rotateReturn ?? stubVkRow({ revision: 2n });
  const revokeReturn =
    opts.revokeReturn ?? stubVkRow({ status: "REVOKED", revokedAt: new Date() });

  const findByIdMock = vi.fn(async () => existing);
  const createMock = vi.fn(async () => createReturn);
  const replaceChainMock = vi.fn(async () => undefined);
  const rotateSecretMock = vi.fn(async () => rotateReturn);
  const revokeMock = vi.fn(async () => revokeReturn);
  const auditAppend = vi.fn(async () => undefined);
  const changeAppend = vi.fn(async () => ({ revision: 1n }));
  const providerCount = vi.fn(async () => opts.providerCredentialCount ?? 1);
  const vkUpdateMock = vi.fn(async () => updateReturn);

  const repository = {
    findAll: async () => [],
    findById: findByIdMock,
    findByHashedSecret: async () => null,
    create: createMock,
    replaceProviderChain: replaceChainMock,
    rotateSecret: rotateSecretMock,
    revoke: revokeMock,
    recordUsage: async () => undefined,
  } as unknown as VirtualKeyRepository;

  const changeEvents = { append: changeAppend } as unknown as ChangeEventRepository;
  const auditLog = { append: auditAppend } as unknown as GatewayAuditLogRepository;

  const prisma = {
    gatewayProviderCredential: { count: providerCount },
    virtualKey: { update: vkUpdateMock },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ virtualKey: { update: vkUpdateMock } }),
  } as unknown as PrismaClient;

  const service = new VirtualKeyService(prisma, repository, changeEvents, auditLog);
  return {
    prisma,
    repository,
    changeEvents,
    auditLog,
    service,
    findByIdMock,
    createMock,
    replaceChainMock,
    rotateSecretMock,
    revokeMock,
    auditAppend,
    changeAppend,
    providerCount,
    vkUpdateMock,
  };
}

const baseCreate = {
  projectId: "proj_01",
  organizationId: "org_01",
  name: "prod-openai",
  environment: "live" as const,
  providerCredentialIds: ["gpc_01"],
  actorUserId: "user_01",
};

describe("VirtualKeyService.create", () => {
  describe("when no provider credentials are passed", () => {
    it("throws BAD_REQUEST before any DB write", async () => {
      const mocks = makeService();

      await expect(
        mocks.service.create({ ...baseCreate, providerCredentialIds: [] }),
      ).rejects.toBeInstanceOf(TRPCError);

      expect(mocks.createMock).not.toHaveBeenCalled();
    });
  });

  describe("when a provider credential belongs to a different project", () => {
    it("throws BAD_REQUEST (cross-project credential injection guard)", async () => {
      // count() returns 0 for cross-project creds since they're filtered
      // by projectId in the WHERE.
      const mocks = makeService({ providerCredentialCount: 0 });

      await expect(mocks.service.create({ ...baseCreate })).rejects.toThrow(
        /do not belong to this project/,
      );
    });
  });

  describe("happy path", () => {
    it("mints a fresh secret, hashes it, and returns the raw secret exactly once", async () => {
      const mocks = makeService();

      const result = await mocks.service.create({ ...baseCreate });

      // Raw secret is exposed via the return value…
      expect(result.secret).toMatch(/^lw_vk_live_/);
      // …but the hashedSecret passed to the repo never matches the raw.
      const created = mocks.createMock.mock.calls[0]?.[0] as {
        hashedSecret: string;
      };
      expect(created.hashedSecret).toBeTruthy();
      expect(created.hashedSecret).not.toBe(result.secret);
    });

    it("emits VK_CREATED change-event + VIRTUAL_KEY_CREATED audit in same tx", async () => {
      const mocks = makeService();

      await mocks.service.create({ ...baseCreate });

      expect(mocks.changeAppend).toHaveBeenCalledOnce();
      expect(mocks.changeAppend.mock.calls[0]?.[0].kind).toBe("VK_CREATED");
      expect(mocks.auditAppend).toHaveBeenCalledOnce();
      expect(mocks.auditAppend.mock.calls[0]?.[0].action).toBe(
        "VIRTUAL_KEY_CREATED",
      );
    });

    it("merges partial config over defaults (caller doesn't lose fallback.on etc)", async () => {
      const mocks = makeService();

      await mocks.service.create({
        ...baseCreate,
        config: { cache: { mode: "disable", ttlS: 0 } },
      });

      const created = mocks.createMock.mock.calls[0]?.[0] as {
        config: {
          cache: { mode: string };
          fallback: { on: string[] };
          guardrails: { requestFailOpen: boolean };
        };
      };
      expect(created.config.cache.mode).toBe("disable");
      // Defaults survive the partial merge.
      expect(created.config.fallback.on).toContain("5xx");
      expect(created.config.guardrails.requestFailOpen).toBe(false);
    });
  });
});

describe("VirtualKeyService.update", () => {
  describe("when the VK is REVOKED", () => {
    it("throws BAD_REQUEST — revoked keys are immutable", async () => {
      const mocks = makeService({
        existing: stubVkRow({ status: "REVOKED" }),
      });

      await expect(
        mocks.service.update({
          id: "vk_01",
          projectId: "proj_01",
          organizationId: "org_01",
          actorUserId: "user_01",
          name: "renamed",
        }),
      ).rejects.toThrow(/Cannot update a revoked/);
    });
  });

  describe("when the provider chain is not passed", () => {
    it("does NOT touch the chain (preserves existing order)", async () => {
      const mocks = makeService();

      await mocks.service.update({
        id: "vk_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
        name: "renamed",
      });

      expect(mocks.replaceChainMock).not.toHaveBeenCalled();
    });
  });

  describe("when the provider chain IS passed", () => {
    it("validates cross-project ownership + replaces chain in same tx", async () => {
      const mocks = makeService({ providerCredentialCount: 2 });

      await mocks.service.update({
        id: "vk_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
        providerCredentialIds: ["gpc_a", "gpc_b"],
      });

      expect(mocks.replaceChainMock).toHaveBeenCalledOnce();
    });
  });
});

describe("VirtualKeyService.rotate", () => {
  describe("when the VK is REVOKED", () => {
    it("throws BAD_REQUEST — cannot rotate a revoked key", async () => {
      const mocks = makeService({
        existing: stubVkRow({ status: "REVOKED" }),
      });

      await expect(
        mocks.service.rotate({
          id: "vk_01",
          projectId: "proj_01",
          organizationId: "org_01",
          actorUserId: "user_01",
        }),
      ).rejects.toThrow(/Cannot rotate a revoked/);
    });
  });

  describe("happy path", () => {
    it("returns a new secret and passes the old hash as previousSecret for the 24h grace window", async () => {
      const mocks = makeService();

      const result = await mocks.service.rotate({
        id: "vk_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
      });

      expect(result.secret).toMatch(/^lw_vk_live_/);
      const rotateArgs = mocks.rotateSecretMock.mock.calls[0];
      // Arg 4 is the old hashedSecret per the repository signature.
      expect(rotateArgs?.[4]).toBe("HASHED_CURRENT");
    });
  });
});

describe("VirtualKeyService.revoke", () => {
  describe("when the VK is already REVOKED", () => {
    it("is idempotent — returns the existing row without re-writing audit", async () => {
      const mocks = makeService({
        existing: stubVkRow({ status: "REVOKED" }),
      });

      const result = await mocks.service.revoke({
        id: "vk_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
      });

      expect(result.status).toBe("REVOKED");
      expect(mocks.revokeMock).not.toHaveBeenCalled();
      expect(mocks.auditAppend).not.toHaveBeenCalled();
      expect(mocks.changeAppend).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("calls repository.revoke + emits VK_REVOKED change-event + audit", async () => {
      const mocks = makeService();

      await mocks.service.revoke({
        id: "vk_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
      });

      expect(mocks.revokeMock).toHaveBeenCalledOnce();
      expect(mocks.changeAppend.mock.calls[0]?.[0].kind).toBe("VK_REVOKED");
      expect(mocks.auditAppend.mock.calls[0]?.[0].action).toBe(
        "VIRTUAL_KEY_REVOKED",
      );
    });
  });
});

describe("VirtualKeyService.getById", () => {
  describe("when the VK does not exist in the caller's project", () => {
    it("returns null (service layer does not throw — the tRPC layer maps to 404)", async () => {
      const mocks = makeService({ existing: null });

      const result = await mocks.service.getById("vk_missing", "proj_01");

      expect(result).toBeNull();
    });
  });
});
