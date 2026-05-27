import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^enc:/, "")),
}));

import type { PrismaClient } from "@prisma/client";

import {
  LangyCredentialResolutionError,
  LangyCredentialService,
} from "../LangyCredentialService";
import type { VirtualKeyService } from "~/server/gateway/virtualKey.service";

type MockOverrides = Partial<Record<string, Record<string, unknown>>>;

function makePrisma(overrides: MockOverrides = {}): PrismaClient {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        apiKey: "sk-lw-test-project-key",
        team: { organizationId: "org-1" },
      }),
      ...overrides.project,
    },
    projectSecret: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      ...overrides.projectSecret,
    },
    gatewayProviderCredential: {
      findFirst: vi.fn().mockResolvedValue({ id: "gpc-1" }),
      ...overrides.gatewayProviderCredential,
    },
  } as unknown as PrismaClient;
}

function makeVkService(
  overrides: Partial<VirtualKeyService> = {},
): VirtualKeyService {
  return {
    create: vi
      .fn()
      .mockResolvedValue({ secret: "lw_vk_live_provisioned", virtualKey: { id: "vk-1" } }),
    ...overrides,
  } as unknown as VirtualKeyService;
}

beforeEach(() => {
  process.env.LANGWATCH_API_URL = "https://api.langwatch.test";
  process.env.LW_GATEWAY_BASE_URL = "http://gateway.test:5563/v1";
});

describe("LangyCredentialService", () => {
  describe("given an existing Langy VK secret in ProjectSecret", () => {
    describe("when getOrProvision is called", () => {
      it("returns the decrypted secret without re-provisioning", async () => {
        const prisma = makePrisma({
          projectSecret: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ encryptedValue: "enc:lw_vk_live_stored" }),
          },
        });
        const vk = makeVkService();
        const svc = new LangyCredentialService(prisma, vk);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_stored");
        expect(creds.langwatchApiKey).toBe("sk-lw-test-project-key");
        expect(creds.langwatchEndpoint).toBe("https://api.langwatch.test");
        expect(creds.gatewayBaseUrl).toBe("http://gateway.test:5563/v1");
        expect(vk.create).not.toHaveBeenCalled();
        expect(prisma.projectSecret.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given no stored secret + a configured provider credential", () => {
    describe("when getOrProvision is called", () => {
      it("provisions a new VK, stores the encrypted secret, returns the plaintext", async () => {
        const prisma = makePrisma();
        const vk = makeVkService();
        const svc = new LangyCredentialService(prisma, vk);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_provisioned");
        expect(vk.create).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "p1",
            organizationId: "org-1",
            environment: "live",
            providerCredentialIds: ["gpc-1"],
            actorUserId: "u1",
          }),
        );
        expect(prisma.projectSecret.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            projectId: "p1",
            name: "langy_vk_secret",
            encryptedValue: "enc:lw_vk_live_provisioned",
            createdById: "u1",
            updatedById: "u1",
          }),
        });
      });
    });
  });

  describe("given no provider credential configured for the project", () => {
    describe("when getOrProvision is called", () => {
      it("throws LangyCredentialResolutionError with an actionable message", async () => {
        const prisma = makePrisma({
          gatewayProviderCredential: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        });
        const vk = makeVkService();
        const svc = new LangyCredentialService(prisma, vk);

        await expect(
          svc.getOrProvision({ projectId: "p1", actorUserId: "u1" }),
        ).rejects.toThrow(LangyCredentialResolutionError);
        await expect(
          svc.getOrProvision({ projectId: "p1", actorUserId: "u1" }),
        ).rejects.toThrow(/Settings → Model Providers/);
        expect(vk.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project doesn't exist", () => {
    describe("when getOrProvision is called", () => {
      it("throws LangyCredentialResolutionError", async () => {
        const prisma = makePrisma({
          project: { findUnique: vi.fn().mockResolvedValue(null) },
        });
        const vk = makeVkService();
        const svc = new LangyCredentialService(prisma, vk);

        await expect(
          svc.getOrProvision({ projectId: "missing", actorUserId: "u1" }),
        ).rejects.toThrow(LangyCredentialResolutionError);
      });
    });
  });

  describe("given env config is incomplete", () => {
    describe("when LW_GATEWAY_BASE_URL is unset", () => {
      it("throws LangyCredentialResolutionError before any provisioning", async () => {
        delete process.env.LW_GATEWAY_BASE_URL;
        const prisma = makePrisma();
        const vk = makeVkService();
        const svc = new LangyCredentialService(prisma, vk);

        await expect(
          svc.getOrProvision({ projectId: "p1", actorUserId: "u1" }),
        ).rejects.toThrow(/LW_GATEWAY_BASE_URL/);
        expect(vk.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given two simultaneous first-use requests for the same project", () => {
    describe("when the ProjectSecret.create loses the race with P2002", () => {
      it("re-reads the winner's encrypted secret and returns the decrypted plaintext", async () => {
        const p2002 = new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed",
          { code: "P2002", clientVersion: "test" } as unknown as ConstructorParameters<
            typeof Prisma.PrismaClientKnownRequestError
          >[1],
        );
        const prisma = makePrisma({
          projectSecret: {
            // First lookup misses (we race to provision).
            findUnique: vi
              .fn()
              // First call: race-loser sees no secret yet
              .mockResolvedValueOnce(null)
              // Recovery call after P2002: winner's row is now visible
              .mockResolvedValueOnce({ encryptedValue: "enc:lw_vk_live_winner" }),
            create: vi.fn().mockRejectedValue(p2002),
          },
        });
        const vk = makeVkService();
        const svc = new LangyCredentialService(prisma, vk);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_winner");
        // We still attempted to provision (the orphan VK we just created
        // is acceptable v1 collateral — comment in the service explains).
        expect(vk.create).toHaveBeenCalledOnce();
      });
    });
  });
});
