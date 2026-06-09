import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^enc:/, "")),
}));

import {
  LangyCredentialResolutionError,
  LangyCredentialService,
} from "../LangyCredentialService";

function makePrisma(overrides: any = {}) {
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
  } as any;
}

function makeVkService(overrides: any = {}) {
  return {
    create: vi
      .fn()
      .mockResolvedValue({ secret: "lw_vk_live_provisioned", virtualKey: { id: "vk-1" } }),
    ...overrides,
  } as any;
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

  describe("given no stored secret", () => {
    describe("when getOrProvision is called", () => {
      it("provisions a project-scoped VK, stores the encrypted secret, returns the plaintext", async () => {
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
            organizationId: "org-1",
            name: "Langy",
            principalUserId: null,
            scopes: [{ scopeType: "PROJECT", scopeId: "p1" }],
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
          { code: "P2002", clientVersion: "test" } as any,
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

  // Server-side allowlist read used by /langy/chat to reject tampered
  // `modelOverride` values before they reach the OpenCode pod. The picker
  // UI also narrows by this list — the server check is defense in depth.
  describe("getModelsAllowed", () => {
    function makeVkWithScopeQuery(vks: Array<unknown>) {
      return {
        getAllForScope: vi.fn().mockResolvedValue(vks),
      } as any;
    }

    describe("when the Langy VK has a modelsAllowed array configured", () => {
      it("returns the array", async () => {
        const prisma = makePrisma();
        const vk = makeVkWithScopeQuery([
          {
            name: "Langy",
            principalUserId: null,
            organizationId: "org-1",
            config: { modelsAllowed: ["anthropic/claude-opus-4-7"] },
          },
        ]);
        const svc = new LangyCredentialService(prisma, vk);

        const result = await svc.getModelsAllowed("p1", "org-1");

        expect(result).toEqual(["anthropic/claude-opus-4-7"]);
        expect(vk.getAllForScope).toHaveBeenCalledWith({
          scopeType: "PROJECT",
          scopeId: "p1",
        });
      });
    });

    describe("when the Langy VK has modelsAllowed=null", () => {
      it("returns null — caller treats as 'no allowlist, gateway enforces'", async () => {
        const prisma = makePrisma();
        const vk = makeVkWithScopeQuery([
          {
            name: "Langy",
            principalUserId: null,
            organizationId: "org-1",
            config: { modelsAllowed: null },
          },
        ]);
        const svc = new LangyCredentialService(prisma, vk);

        expect(await svc.getModelsAllowed("p1", "org-1")).toBeNull();
      });
    });

    describe("when the Langy VK has modelsAllowed=[] (empty)", () => {
      it("returns null — empty arrays are equivalent to 'unset' for this check", async () => {
        const prisma = makePrisma();
        const vk = makeVkWithScopeQuery([
          {
            name: "Langy",
            principalUserId: null,
            organizationId: "org-1",
            config: { modelsAllowed: [] },
          },
        ]);
        const svc = new LangyCredentialService(prisma, vk);

        expect(await svc.getModelsAllowed("p1", "org-1")).toBeNull();
      });
    });

    describe("when no Langy VK exists for the project", () => {
      it("returns null", async () => {
        const prisma = makePrisma();
        const vk = makeVkWithScopeQuery([]);
        const svc = new LangyCredentialService(prisma, vk);

        expect(await svc.getModelsAllowed("p1", "org-1")).toBeNull();
      });
    });

    describe("when another VK in scope is named 'Langy' but has a principalUserId", () => {
      it("ignores it — only the auto-managed (principalUserId=null) Langy VK counts", async () => {
        const prisma = makePrisma();
        const vk = makeVkWithScopeQuery([
          {
            name: "Langy",
            principalUserId: "u-impersonator",
            organizationId: "org-1",
            config: { modelsAllowed: ["evil/model"] },
          },
        ]);
        const svc = new LangyCredentialService(prisma, vk);

        expect(await svc.getModelsAllowed("p1", "org-1")).toBeNull();
      });
    });

    describe("when a Langy VK belongs to a different organization", () => {
      it("ignores it — cross-org leakage guard", async () => {
        const prisma = makePrisma();
        const vk = makeVkWithScopeQuery([
          {
            name: "Langy",
            principalUserId: null,
            organizationId: "org-OTHER",
            config: { modelsAllowed: ["anthropic/claude-opus-4-7"] },
          },
        ]);
        const svc = new LangyCredentialService(prisma, vk);

        expect(await svc.getModelsAllowed("p1", "org-1")).toBeNull();
      });
    });
  });
});
