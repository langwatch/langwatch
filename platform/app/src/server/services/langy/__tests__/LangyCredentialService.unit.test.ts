import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^enc:/, "")),
}));

// The VK provisioning path creates its own VirtualKeyService internally;
// intercept the factory so assertions can observe `create` calls.
const vkCreate = vi.fn();
vi.mock("~/server/gateway/virtualKey.service", () => ({
  VirtualKeyService: {
    create: vi.fn(() => ({ create: vkCreate })),
  },
}));

// No model default configured unless a test says otherwise — provisioning
// must tolerate that (modelsAllowed stays null).
vi.mock("~/server/modelProviders/modelDefaults.read", () => ({
  getResolvedDefaultForFeature: vi.fn().mockResolvedValue(null),
}));

// The dedicated Langy API key has its own unit suite; here it is a
// collaborator. The default mock returns a real token so the credential
// service can hand the worker a least-privilege key. The "no token"
// path now throws — covered by an explicit test below. Hoisted so the
// vi.mock factory can reference them without TDZ errors.
const { getLangyApiKeyToken, provisionLangyApiKey } = vi.hoisted(() => ({
  getLangyApiKeyToken: vi.fn().mockResolvedValue("sk-lw-test-langy-token"),
  provisionLangyApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../langyApiKey", () => ({
  provisionLangyApiKey,
  getLangyApiKeyToken,
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
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      ...overrides.projectSecret,
    },
  } as any;
}

beforeEach(() => {
  vkCreate.mockReset();
  vkCreate.mockResolvedValue({
    secret: "lw_vk_live_provisioned",
    virtualKey: { id: "vk-1" },
  });
  getLangyApiKeyToken.mockReset();
  getLangyApiKeyToken.mockResolvedValue("sk-lw-test-langy-token");
  provisionLangyApiKey.mockReset();
  provisionLangyApiKey.mockResolvedValue(undefined);
  process.env.LANGWATCH_API_URL = "https://api.langwatch.test";
  process.env.LW_GATEWAY_BASE_URL = "http://gateway.test:5563/v1";
  // Clear LW_GATEWAY_PUBLIC_URL so it doesn't leak in from the developer's
  // shell (`pnpm dev` setups pre-source .env to dodge the start.sh defaulting
  // bug, and that .env now carries LW_GATEWAY_PUBLIC_URL on the WSL+minikube
  // layout). The credential service prefers PUBLIC over BASE, so an inherited
  // value would shadow whatever the test pins via LW_GATEWAY_BASE_URL above.
  delete process.env.LW_GATEWAY_PUBLIC_URL;
});

describe("LangyCredentialService", () => {
  describe("given an existing Langy VK secret in ProjectSecret", () => {
    describe("when getOrProvision is called", () => {
      it("returns the decrypted secret without re-provisioning", async () => {
        const prisma = makePrisma({
          projectSecret: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ encryptedValue: "enc:lw_vk_live_stored" }),
            create: vi.fn().mockResolvedValue({}),
          },
        });
        const svc = new LangyCredentialService(prisma);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_stored");
        expect(creds.langwatchApiKey).toBe("sk-lw-test-langy-token");
        expect(creds.langwatchEndpoint).toBe("https://api.langwatch.test");
        expect(creds.gatewayBaseUrl).toBe("http://gateway.test:5563/v1");
        expect(vkCreate).not.toHaveBeenCalled();
        expect(prisma.projectSecret.create).not.toHaveBeenCalled();
      });

      it("appends /v1 when LW_GATEWAY_BASE_URL lacks it (the dev-cluster bug)", async () => {
        // The SaaS dev cluster set LW_GATEWAY_BASE_URL=http://langwatch-gateway:80
        // (no /v1), so the worker POSTed to /responses → 404. The credential
        // service must hand the worker an OpenAI-compatible /v1 base.
        process.env.LW_GATEWAY_BASE_URL = "http://langwatch-gateway:80";
        const prisma = makePrisma({
          projectSecret: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ encryptedValue: "enc:lw_vk_live_stored" }),
            create: vi.fn().mockResolvedValue({}),
          },
        });
        const svc = new LangyCredentialService(prisma);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.gatewayBaseUrl).toBe("http://langwatch-gateway:80/v1");
      });

      it("does not double-append /v1 and tolerates a trailing slash", async () => {
        process.env.LW_GATEWAY_BASE_URL = "http://langwatch-gateway:80/v1/";
        const prisma = makePrisma({
          projectSecret: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ encryptedValue: "enc:lw_vk_live_stored" }),
            create: vi.fn().mockResolvedValue({}),
          },
        });
        const svc = new LangyCredentialService(prisma);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.gatewayBaseUrl).toBe("http://langwatch-gateway:80/v1");
      });
    });
  });

  describe("given no stored secret", () => {
    describe("when getOrProvision is called", () => {
      it("provisions a project-scoped VK, stores the encrypted secret, returns the plaintext", async () => {
        const prisma = makePrisma();
        const svc = new LangyCredentialService(prisma);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_provisioned");
        expect(vkCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            name: "Langy",
            principalUserId: null,
            scopes: [{ scopeType: "PROJECT", scopeId: "p1" }],
            actorUserId: "u1",
            purpose: "LANGY",
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
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getOrProvision({ projectId: "missing", actorUserId: "u1" }),
        ).rejects.toThrow(LangyCredentialResolutionError);
      });
    });
  });

  describe("given Langy API key provisioning yields no token", () => {
    // Reachable when resolveAttributionUserId returns null (e.g. an org
    // with no active members). Falling back to project.apiKey here would
    // hand the worker a key that bypasses LANGY_REQUIRED_PERMISSIONS — the
    // whole RBAC gate. Fail-closed: throw so the route returns 409 and the
    // user gets a clear actionable error instead of silent over-privilege.
    describe("when getLangyApiKeyToken returns null", () => {
      it("throws LangyCredentialResolutionError and does not fall back to project.apiKey", async () => {
        getLangyApiKeyToken.mockResolvedValue(null);
        const prisma = makePrisma();
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getOrProvision({ projectId: "p1", actorUserId: "u1" }),
        ).rejects.toThrowError(
          expect.objectContaining({
            name: "LangyCredentialResolutionError",
            message: expect.stringMatching(/no user could be attributed/),
          }),
        );
      });
    });
  });

  describe("given env config is incomplete", () => {
    describe("when LW_GATEWAY_BASE_URL is unset", () => {
      it("throws LangyCredentialResolutionError before any provisioning", async () => {
        delete process.env.LW_GATEWAY_BASE_URL;
        const prisma = makePrisma();
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getOrProvision({ projectId: "p1", actorUserId: "u1" }),
        ).rejects.toThrow(/LW_GATEWAY_BASE_URL/);
        expect(vkCreate).not.toHaveBeenCalled();
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
            findFirst: vi
              .fn()
              // First call: race-loser sees no secret yet
              .mockResolvedValueOnce(null)
              // Recovery call after P2002: winner's row is now visible
              .mockResolvedValueOnce({
                encryptedValue: "enc:lw_vk_live_winner",
              }),
            create: vi.fn().mockRejectedValue(p2002),
          },
        });
        const svc = new LangyCredentialService(prisma);

        const creds = await svc.getOrProvision({
          projectId: "p1",
          actorUserId: "u1",
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_winner");
        // We still attempted to provision (the orphan VK we just created
        // is acceptable v1 collateral — comment in the service explains).
        expect(vkCreate).toHaveBeenCalledOnce();
      });
    });
  });

  // Server-side allowlist read used by /langy/chat to reject tampered
  // `modelOverride` values before they reach the OpenCode pod. The picker
  // UI also narrows by this list — the server check is defense in depth.
  // The query happens at the DB layer (organizationId + purpose +
  // project-scope are all in the Prisma WHERE), so the tests assert both:
  // (a) the right WHERE was issued, and (b) the config value is returned
  // through Zod parsing.
  describe("getModelsAllowed", () => {
    function makePrismaWithVk(vk: unknown) {
      return {
        ...makePrisma(),
        virtualKey: {
          findFirst: vi.fn().mockResolvedValue(vk),
        },
      } as any;
    }

    describe("when the Langy VK has a modelsAllowed array configured", () => {
      it("returns the array and queries with the full tenancy WHERE", async () => {
        const prisma = makePrismaWithVk({
          config: { modelsAllowed: ["anthropic/claude-opus-4-7"] },
        });
        const svc = new LangyCredentialService(prisma);

        const result = await svc.getModelsAllowed({
          projectId: "p1",
          organizationId: "org-1",
        });

        expect(result).toEqual(["anthropic/claude-opus-4-7"]);
        // Tenancy (org), identity (purpose=LANGY), reachability (scope
        // row), AND liveness (status=ACTIVE) all enforced at the DB layer.
        // status=ACTIVE blocks an archived twin's modelsAllowed from
        // bleeding through after the provisioning race leaves a duplicate
        // row alive (langyVirtualKey.ts:82-95); orderBy:updatedAt-desc
        // picks the most recently rotated row when more than one ACTIVE
        // row exists, matching the gateway's own resolution priority.
        // Drift in any of these is a load-bearing bug.
        expect(prisma.virtualKey.findFirst).toHaveBeenCalledWith({
          where: {
            organizationId: "org-1",
            purpose: "LANGY",
            status: "ACTIVE",
            scopes: {
              some: { scopeType: "PROJECT", scopeId: "p1" },
            },
          },
          orderBy: { updatedAt: "desc" },
          select: { config: true },
        });
      });
    });

    describe("when the Langy VK has modelsAllowed=null", () => {
      it("returns null — caller treats as 'no allowlist, gateway enforces'", async () => {
        const prisma = makePrismaWithVk({ config: { modelsAllowed: null } });
        const svc = new LangyCredentialService(prisma);

        expect(
          await svc.getModelsAllowed({
            projectId: "p1",
            organizationId: "org-1",
          }),
        ).toBeNull();
      });
    });

    describe("when the Langy VK has modelsAllowed=[] (empty)", () => {
      it("returns null — empty arrays are equivalent to 'unset' for this check", async () => {
        const prisma = makePrismaWithVk({ config: { modelsAllowed: [] } });
        const svc = new LangyCredentialService(prisma);

        expect(
          await svc.getModelsAllowed({
            projectId: "p1",
            organizationId: "org-1",
          }),
        ).toBeNull();
      });
    });

    describe("when the tenancy WHERE excludes the VK (wrong org, principalUserId, or no scope)", () => {
      it("returns null because findFirst itself returns null", async () => {
        // Standing in for: cross-org leakage, impersonator-named-Langy, or
        // a VK that's never been project-scoped. All three states collapse
        // to "findFirst returns null" because the WHERE filters them out.
        const prisma = makePrismaWithVk(null);
        const svc = new LangyCredentialService(prisma);

        expect(
          await svc.getModelsAllowed({
            projectId: "p1",
            organizationId: "org-1",
          }),
        ).toBeNull();
      });
    });

    describe("when the VK config is malformed JSON", () => {
      it("throws (via parseVirtualKeyConfig) — silent-disable on drift would defeat the check", async () => {
        const prisma = makePrismaWithVk({
          config: { modelsAllowed: "not-an-array" as unknown as string[] },
        });
        const svc = new LangyCredentialService(prisma);

        // We don't care what the error type is — only that it's not "null"
        // (the silent-disable footgun the Zod parse is here to prevent).
        await expect(
          svc.getModelsAllowed({ projectId: "p1", organizationId: "org-1" }),
        ).rejects.toThrow();
      });
    });
  });
});
