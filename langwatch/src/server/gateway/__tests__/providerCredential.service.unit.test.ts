import type {
  GatewayProviderCredential,
  ModelProvider,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { GatewayProviderCredentialService } from "../providerCredential.service";

type Row = GatewayProviderCredential & { modelProvider: ModelProvider };

function stubModelProvider(
  overrides: Partial<ModelProvider> = {},
): ModelProvider {
  return {
    id: "mp_01",
    projectId: "proj_01",
    provider: "openai",
    enabled: true,
    customKeys: null,
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    disabledByDefault: false,
    ...overrides,
  } as unknown as ModelProvider;
}

function stubRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "gpc_01",
    projectId: "proj_01",
    modelProviderId: "mp_01",
    slot: "primary",
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    rotationPolicy: "MANUAL",
    extraHeaders: null,
    providerConfig: null,
    fallbackPriorityGlobal: null,
    healthStatus: "UNKNOWN",
    circuitOpenedAt: null,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    modelProvider: stubModelProvider(),
    ...overrides,
  } as unknown as Row;
}

function mockPrisma(args: {
  modelProvider?: ModelProvider | null;
  existing?: Row | null;
  createReturn?: Row;
  updateReturn?: Row;
}): {
  prisma: PrismaClient;
  createArgs: ReturnType<typeof vi.fn>;
  updateArgs: ReturnType<typeof vi.fn>;
  changeEventCreate: ReturnType<typeof vi.fn>;
  auditCreate: ReturnType<typeof vi.fn>;
} {
  const createArgs = vi.fn();
  const updateArgs = vi.fn();
  const changeEventCreate = vi.fn(async () => ({ revision: 1n }));
  const auditCreate = vi.fn(async () => ({ id: "audit_01" }));

  const gatewayProviderCredential = {
    findMany: async () => [],
    findFirst: async () => args.existing ?? null,
    create: async (a: unknown) => {
      createArgs(a);
      return args.createReturn ?? stubRow();
    },
    update: async (a: unknown) => {
      updateArgs(a);
      return args.updateReturn ?? stubRow();
    },
  };

  const prisma = {
    modelProvider: {
      findFirst: async () => args.modelProvider ?? null,
    },
    gatewayProviderCredential,
    gatewayChangeEvent: { create: changeEventCreate },
    gatewayAuditLog: { create: auditCreate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        gatewayProviderCredential,
        gatewayChangeEvent: { create: changeEventCreate },
        gatewayAuditLog: { create: auditCreate },
      }),
  } as unknown as PrismaClient;

  return { prisma, createArgs, updateArgs, changeEventCreate, auditCreate };
}

const baseCreate = {
  projectId: "proj_01",
  organizationId: "org_01",
  modelProviderId: "mp_01",
  actorUserId: "user_01",
};

describe("GatewayProviderCredentialService.create", () => {
  describe("when the target ModelProvider does not belong to the project", () => {
    it("throws NOT_FOUND (project scope isolation)", async () => {
      const { prisma } = mockPrisma({ modelProvider: null });
      const sut = GatewayProviderCredentialService.create(prisma);

      await expect(sut.create({ ...baseCreate })).rejects.toBeInstanceOf(
        TRPCError,
      );
    });
  });

  describe("when the target ModelProvider is disabled", () => {
    it("throws BAD_REQUEST with a message pointing at project settings", async () => {
      const { prisma } = mockPrisma({
        modelProvider: stubModelProvider({ enabled: false }),
      });
      const sut = GatewayProviderCredentialService.create(prisma);

      await expect(sut.create({ ...baseCreate })).rejects.toThrow(
        /Enable it in Settings/,
      );
    });
  });

  describe("happy path", () => {
    it("defaults slot='primary' and rotationPolicy='MANUAL' when unspecified", async () => {
      const { prisma, createArgs } = mockPrisma({
        modelProvider: stubModelProvider(),
      });
      const sut = GatewayProviderCredentialService.create(prisma);

      await sut.create({ ...baseCreate });

      expect(createArgs).toHaveBeenCalledOnce();
      const data = createArgs.mock.calls[0]?.[0].data;
      expect(data.slot).toBe("primary");
      expect(data.rotationPolicy).toBe("MANUAL");
    });

    it("emits a PROVIDER_BINDING_UPDATED change-event + PROVIDER_BINDING_CREATED audit entry", async () => {
      const { prisma, changeEventCreate, auditCreate } = mockPrisma({
        modelProvider: stubModelProvider(),
      });
      const sut = GatewayProviderCredentialService.create(prisma);

      await sut.create({ ...baseCreate });

      expect(changeEventCreate).toHaveBeenCalledOnce();
      expect(auditCreate).toHaveBeenCalledOnce();
      expect(auditCreate.mock.calls[0]?.[0].data.action).toBe(
        "PROVIDER_BINDING_CREATED",
      );
    });
  });
});

describe("GatewayProviderCredentialService.update", () => {
  describe("when the binding does not exist in the caller's project", () => {
    it("throws NOT_FOUND", async () => {
      const { prisma } = mockPrisma({ existing: null });
      const sut = GatewayProviderCredentialService.create(prisma);

      await expect(
        sut.update({
          id: "gpc_missing",
          projectId: "proj_01",
          organizationId: "org_01",
          actorUserId: "user_01",
        }),
      ).rejects.toBeInstanceOf(TRPCError);
    });
  });

  describe("when the caller omits a field", () => {
    it("preserves the existing value rather than overwriting with undefined", async () => {
      const existing = stubRow({
        slot: "fallback-1",
        rateLimitRpm: 500,
        rotationPolicy: "EXTERNAL_SECRET_STORE",
      });
      const { prisma, updateArgs } = mockPrisma({ existing });
      const sut = GatewayProviderCredentialService.create(prisma);

      await sut.update({
        id: "gpc_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
        rateLimitRpd: 10_000,
      });

      const data = updateArgs.mock.calls[0]?.[0].data;
      expect(data.slot).toBe("fallback-1");
      expect(data.rateLimitRpm).toBe(500);
      expect(data.rateLimitRpd).toBe(10_000);
      expect(data.rotationPolicy).toBe("EXTERNAL_SECRET_STORE");
    });
  });

  describe("when rateLimitRpm is explicitly set to null", () => {
    it("clears the cap (null must not be treated as 'unchanged')", async () => {
      const existing = stubRow({ rateLimitRpm: 500 });
      const { prisma, updateArgs } = mockPrisma({ existing });
      const sut = GatewayProviderCredentialService.create(prisma);

      await sut.update({
        id: "gpc_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
        rateLimitRpm: null,
      });

      expect(updateArgs.mock.calls[0]?.[0].data.rateLimitRpm).toBeNull();
    });
  });
});

describe("GatewayProviderCredentialService.disable", () => {
  describe("when the binding exists", () => {
    it("sets disabledAt + emits audit with PROVIDER_BINDING_UPDATED action", async () => {
      const existing = stubRow({ disabledAt: null });
      const { prisma, updateArgs, auditCreate } = mockPrisma({ existing });
      const sut = GatewayProviderCredentialService.create(prisma);

      await sut.disable({
        id: "gpc_01",
        projectId: "proj_01",
        organizationId: "org_01",
        actorUserId: "user_01",
      });

      expect(updateArgs.mock.calls[0]?.[0].data.disabledAt).toBeInstanceOf(
        Date,
      );
      expect(auditCreate.mock.calls[0]?.[0].data.action).toBe(
        "PROVIDER_BINDING_UPDATED",
      );
    });
  });

  describe("when the binding does not exist", () => {
    it("throws NOT_FOUND (no audit write)", async () => {
      const { prisma, auditCreate } = mockPrisma({ existing: null });
      const sut = GatewayProviderCredentialService.create(prisma);

      await expect(
        sut.disable({
          id: "gpc_missing",
          projectId: "proj_01",
          organizationId: "org_01",
          actorUserId: "user_01",
        }),
      ).rejects.toBeInstanceOf(TRPCError);

      expect(auditCreate).not.toHaveBeenCalled();
    });
  });
});

// Silence unused-var lint for the Prisma type re-export above.
void ({} as Prisma.InputJsonValue | undefined);
