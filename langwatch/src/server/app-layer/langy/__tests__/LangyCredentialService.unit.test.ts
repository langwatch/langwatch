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

// The per-session Langy key mint has its own unit suite; here it is a
// collaborator. The default mock returns a real token so the credential
// service can hand the worker a caller-scoped key. The "empty held subset"
// path throws LangySessionKeyScopeError — covered by an explicit test below.
// Hoisted so the vi.mock factory can reference them without TDZ errors; the
// error class lives in the hoisted block so `instanceof` checks in the service
// resolve against the same constructor the mock throws.
const { mintLangySessionApiKey, LangySessionKeyScopeError } = vi.hoisted(() => {
  class LangySessionKeyScopeError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LangySessionKeyScopeError";
    }
  }
  return {
    mintLangySessionApiKey: vi
      .fn()
      .mockResolvedValue({
        token: "sk-lw-test-langy-token",
        apiKeyId: "key-1",
      }),
    LangySessionKeyScopeError,
  };
});
vi.mock("../langyApiKey", () => ({
  mintLangySessionApiKey,
  LangySessionKeyScopeError,
}));

// The GitHub installation-token mint (LANGY_GITHUB_ENABLED is a hard `true`
// constant, so getOrProvision always calls this). Hoisted so the vi.mock
// factory can reference it. Default resolves null (mirrors the pre-existing
// behaviour of an uninitialized real App throwing and getOrProvision's
// try/catch swallowing it) so every test above that doesn't care about GitHub
// keeps passing unchanged; only the regression test below configures it.
const { mintTurnToken } = vi.hoisted(() => ({ mintTurnToken: vi.fn() }));
vi.mock("~/server/app-layer", () => ({
  getApp: () => ({
    langy: { githubInstallations: { mintTurnToken } },
  }),
}));

import { ProjectRepository } from "~/server/projects/project.repository";

import {
  LangyCredentialResolutionError,
  LangyCredentialService,
  resolveWorkerCallbackUrl,
  resolveWorkerGatewayBaseUrl,
} from "../LangyCredentialService";

// Every getOrProvision call now takes the requesting user's session (the mint
// needs it to compute the held-permission subset). Fixed to user "u1" so the
// VK path's `actorUserId: "u1"` assertions still hold.
const SESSION = { user: { id: "u1" }, expires: "1" } as any;

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
  mintLangySessionApiKey.mockReset();
  mintLangySessionApiKey.mockResolvedValue({
    token: "sk-lw-test-langy-token",
    apiKeyId: "key-1",
  });
  mintTurnToken.mockReset();
  mintTurnToken.mockResolvedValue(null);
  process.env.LANGWATCH_API_URL = "https://api.langwatch.test";
  // The endpoint prefers LANGWATCH_ENDPOINT over LANGWATCH_API_URL; clear it so
  // the default cases below exercise the LANGWATCH_API_URL fallback path
  // deterministically (same inherited-shell leak rationale as
  // LW_GATEWAY_PUBLIC_URL just below).
  delete process.env.LANGWATCH_ENDPOINT;
  process.env.LW_GATEWAY_BASE_URL = "http://gateway.test:5563/v1";
  // Clear LW_GATEWAY_PUBLIC_URL so it doesn't leak in from the developer's
  // shell (`pnpm dev` setups pre-source .env to dodge the start.sh defaulting
  // bug, and that .env now carries LW_GATEWAY_PUBLIC_URL on the WSL+minikube
  // layout). The credential service prefers PUBLIC over BASE, so an inherited
  // value would shadow whatever the test pins via LW_GATEWAY_BASE_URL above.
  delete process.env.LW_GATEWAY_PUBLIC_URL;
  // The containerized-worker overrides win over both origins above (they point a
  // colima worker at host.docker.internal). Clear them so a value inherited from
  // the developer's shell / .env can't shadow the endpoints these tests pin.
  delete process.env.LANGY_WORKER_CALLBACK_URL;
  delete process.env.LANGY_WORKER_GATEWAY_URL;
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
          session: SESSION,
        });

        expect(creds.llmVirtualKey).toBe("lw_vk_live_stored");
        expect(creds.langwatchApiKey).toBe("sk-lw-test-langy-token");
        expect(creds.langwatchEndpoint).toBe("https://api.langwatch.test");
        expect(creds.gatewayBaseUrl).toBe("http://gateway.test:5563/v1");
        expect(vkCreate).not.toHaveBeenCalled();
        expect(prisma.projectSecret.create).not.toHaveBeenCalled();
      });

      it("prefers LANGWATCH_ENDPOINT (the stable origin) over LANGWATCH_API_URL for the worker callback", async () => {
        // The worker dials credentials.langwatchEndpoint for the relay push, the
        // durable finalize, and its MCP server. Under portless LANGWATCH_API_URL
        // is a raw, haven-assigned loopback port the worker process cannot reach,
        // so the stable LANGWATCH_ENDPOINT hostname must win — otherwise the relay
        // is silently disabled and the turn stalls with no live edge and no error.
        process.env.LANGWATCH_ENDPOINT = "https://app.stack.langwatch.localhost";
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
          session: SESSION,
        });

        expect(creds.langwatchEndpoint).toBe(
          "https://app.stack.langwatch.localhost",
        );
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
          session: SESSION,
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
          session: SESSION,
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
          session: SESSION,
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

  // Regression for #790: every Langy turn minted a GitHub installation token
  // scoped to the WHOLE installation, even for a project bound to one
  // specific repo, because getOrProvision never defaulted
  // `repositoryFullName` from the project when no explicit override was
  // passed — it only forwarded an override the caller happened to supply,
  // and nothing does today. getOrProvision now falls back to
  // `project.repositoryFullName` when no explicit argument is given.
  describe("given a project bound to a specific GitHub repository", () => {
    describe("when getOrProvision is called without an explicit repositoryFullName override", () => {
      it("scopes the minted GitHub installation token to the project's bound repository", async () => {
        const prisma = makePrisma();
        vi.spyOn(
          ProjectRepository.prototype,
          "findForLangyCredentials",
        ).mockResolvedValueOnce({
          apiKey: "sk-lw-test-project-key",
          organizationId: "org-1",
          repositoryFullName: "acme/widgets",
        });
        mintTurnToken.mockResolvedValueOnce({
          token: "ghs_scoped_to_widgets",
          repoScopeKey: "repo:acme/widgets",
          installationId: "inst-1",
        });
        const svc = new LangyCredentialService(prisma);

        await svc.getOrProvision({
          projectId: "p1",
          session: SESSION,
          mintSessionKey: false,
        });

        // No caller passes an explicit `repositoryFullName` override — the
        // service must default it from the project it just resolved.
        expect(mintTurnToken).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            repositoryFullName: "acme/widgets",
          }),
        );
      });
    });
  });

  describe("given a project with no bound GitHub repository", () => {
    describe("when getOrProvision is called", () => {
      it("mints a token scoped to the whole installation", async () => {
        const prisma = makePrisma();
        vi.spyOn(
          ProjectRepository.prototype,
          "findForLangyCredentials",
        ).mockResolvedValueOnce({
          apiKey: "sk-lw-test-project-key",
          organizationId: "org-1",
          repositoryFullName: null,
        });
        mintTurnToken.mockResolvedValueOnce({
          token: "ghs_whole_installation",
          repoScopeKey: null,
          installationId: "inst-1",
        });
        const svc = new LangyCredentialService(prisma);

        await svc.getOrProvision({
          projectId: "p1",
          session: SESSION,
          mintSessionKey: false,
        });

        // No project-bound repo and no explicit override — the
        // `repositoryFullName` key must be absent entirely (not `undefined`
        // or `null`), preserving the pre-fix full-installation behaviour.
        expect(mintTurnToken).toHaveBeenCalledWith(
          expect.not.objectContaining({
            repositoryFullName: expect.anything(),
          }),
        );
      });
    });
  });

  describe("given a project bound to a specific GitHub repository, but the turn passes an explicit override", () => {
    describe("when getOrProvision is called with a repositoryFullName that differs from the project's bound repo", () => {
      it("scopes the minted GitHub installation token to the explicit override, not the project's bound repository", async () => {
        const prisma = makePrisma();
        vi.spyOn(
          ProjectRepository.prototype,
          "findForLangyCredentials",
        ).mockResolvedValueOnce({
          apiKey: "sk-lw-test-project-key",
          organizationId: "org-1",
          repositoryFullName: "acme/widgets",
        });
        mintTurnToken.mockResolvedValueOnce({
          token: "ghs_scoped_to_override",
          repoScopeKey: "repo:explicit/override",
          installationId: "inst-1",
        });
        const svc = new LangyCredentialService(prisma);

        await svc.getOrProvision({
          projectId: "p1",
          session: SESSION,
          mintSessionKey: false,
          repositoryFullName: "explicit/override",
        });

        // Explicit turn-level override wins over the project-level default
        // even though the project has its own bound repo.
        expect(mintTurnToken).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            repositoryFullName: "explicit/override",
          }),
        );
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
          svc.getOrProvision({ projectId: "missing", session: SESSION }),
        ).rejects.toThrow(LangyCredentialResolutionError);
      });
    });
  });

  describe("given the caller holds none of Langy's permissions in the project", () => {
    // The mint computes the held subset and throws LangySessionKeyScopeError
    // when it's empty. Falling back to a broader key here would hand the worker
    // more power than the human has. Fail-closed: wrap as
    // LangyCredentialResolutionError so the route returns 409 with the mint's
    // user-safe message, instead of silent over-privilege.
    describe("when mintLangySessionApiKey throws LangySessionKeyScopeError", () => {
      it("wraps it as LangyCredentialResolutionError surfacing the user-safe message", async () => {
        mintLangySessionApiKey.mockRejectedValue(
          new LangySessionKeyScopeError(
            "You do not hold any of the permissions Langy needs in this project.",
          ),
        );
        const prisma = makePrisma();
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getOrProvision({ projectId: "p1", session: SESSION }),
        ).rejects.toThrowError(
          expect.objectContaining({
            name: "LangyCredentialResolutionError",
            message: expect.stringMatching(/permissions Langy needs/),
          }),
        );
      });
    });

    describe("when mintLangySessionApiKey throws an unexpected error", () => {
      it("wraps it as a generic LangyCredentialResolutionError (no internals leaked)", async () => {
        mintLangySessionApiKey.mockRejectedValue(
          new Error("boom: internal ceiling check exploded"),
        );
        const prisma = makePrisma();
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getOrProvision({ projectId: "p1", session: SESSION }),
        ).rejects.toThrowError(
          expect.objectContaining({
            name: "LangyCredentialResolutionError",
            message: expect.stringMatching(
              /Failed to mint a Langy session key/,
            ),
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
          svc.getOrProvision({ projectId: "p1", session: SESSION }),
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
          session: SESSION,
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

  // Per-project Langy egress allow-list (ADR-043). Read by /langy/chat and
  // threaded into the credentials envelope; the agent's egress adapter is
  // constructed with it at spawn. null/empty = monitor-only (watch, never
  // block); a set list = the enforced set (floor ∪ list). Parsed through Zod so
  // a drifted column fails closed rather than silently disabling enforcement.
  describe("getEgressAllowlist", () => {
    function makePrismaWithProject(langyEgressAllowlist: unknown) {
      const findUnique = vi.fn().mockResolvedValue({ langyEgressAllowlist });
      return {
        project: { findUnique },
      } as any;
    }

    describe("when the project has no allow-list column value", () => {
      it("returns null — monitor-only (watch, never block)", async () => {
        const prisma = makePrismaWithProject(null);
        const svc = new LangyCredentialService(prisma);

        expect(await svc.getEgressAllowlist({ projectId: "p1" })).toBeNull();
        // Reads the Project by its own id (the tenancy filter) and selects only
        // the column — no cross-project value can be returned.
        expect(prisma.project.findUnique).toHaveBeenCalledWith({
          where: { id: "p1" },
          select: { langyEgressAllowlist: true },
        });
      });
    });

    describe("when the allow-list is an empty array", () => {
      it("returns null — empty is equivalent to unset (monitor-only)", async () => {
        const prisma = makePrismaWithProject([]);
        const svc = new LangyCredentialService(prisma);

        expect(await svc.getEgressAllowlist({ projectId: "p1" })).toBeNull();
      });
    });

    describe("when the allow-list has host patterns", () => {
      it("returns the array — the enforced set", async () => {
        const prisma = makePrismaWithProject([
          "registry.npmjs.org",
          "*.internal.acme.com",
        ]);
        const svc = new LangyCredentialService(prisma);

        expect(await svc.getEgressAllowlist({ projectId: "p1" })).toEqual([
          "registry.npmjs.org",
          "*.internal.acme.com",
        ]);
      });
    });

    describe("when the project does not exist", () => {
      it("returns null", async () => {
        const prisma = {
          project: { findUnique: vi.fn().mockResolvedValue(null) },
        } as any;
        const svc = new LangyCredentialService(prisma);

        expect(
          await svc.getEgressAllowlist({ projectId: "missing" }),
        ).toBeNull();
      });
    });

    describe("when the column value is malformed (a drifted non-array)", () => {
      it("throws (via Zod) — a silent-disable would open egress", async () => {
        const prisma = makePrismaWithProject("attacker.example.com");
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getEgressAllowlist({ projectId: "p1" }),
        ).rejects.toThrow();
      });
    });

    describe("when an entry is not a valid host pattern", () => {
      it("throws — a bad pattern must not persist to the enforced set", async () => {
        const prisma = makePrismaWithProject(["not a host!!"]);
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.getEgressAllowlist({ projectId: "p1" }),
        ).rejects.toThrow();
      });
    });
  });

  describe("setEgressAllowlist", () => {
    function makePrismaForWrite() {
      const update = vi.fn().mockResolvedValue({});
      return { prisma: { project: { update } } as any, update };
    }

    describe("when given host patterns", () => {
      it("normalises (trim / lowercase / drop trailing dot) and writes them", async () => {
        const { prisma, update } = makePrismaForWrite();
        const svc = new LangyCredentialService(prisma);

        const saved = await svc.setEgressAllowlist({
          projectId: "p1",
          allowlist: ["Registry.NPMjs.org.", "  *.Internal.Acme.com "],
        });

        expect(saved).toEqual(["registry.npmjs.org", "*.internal.acme.com"]);
        expect(update).toHaveBeenCalledWith({
          where: { id: "p1" },
          data: {
            langyEgressAllowlist: ["registry.npmjs.org", "*.internal.acme.com"],
          },
        });
      });
    });

    describe("when given an empty list", () => {
      it("clears the column to database NULL (back to monitor-only)", async () => {
        const { prisma, update } = makePrismaForWrite();
        const svc = new LangyCredentialService(prisma);

        const saved = await svc.setEgressAllowlist({
          projectId: "p1",
          allowlist: [],
        });

        expect(saved).toBeNull();
        // DbNull writes SQL NULL for a nullable Json column; [] would read back
        // as "empty" which the resolver already treats as null, but null is the
        // canonical unset state.
        expect(update).toHaveBeenCalledWith({
          where: { id: "p1" },
          data: { langyEgressAllowlist: Prisma.DbNull },
        });
      });
    });

    describe("when given an invalid host pattern", () => {
      it("throws before writing anything", async () => {
        const { prisma, update } = makePrismaForWrite();
        const svc = new LangyCredentialService(prisma);

        await expect(
          svc.setEgressAllowlist({ projectId: "p1", allowlist: ["bad host"] }),
        ).rejects.toThrow();
        expect(update).not.toHaveBeenCalled();
      });
    });
  });
});

describe("resolveWorkerCallbackUrl", () => {
  describe("given the containerized-worker override is set", () => {
    it("prefers LANGY_WORKER_CALLBACK_URL over the control-plane origins", () => {
      const url = resolveWorkerCallbackUrl({
        LANGY_WORKER_CALLBACK_URL: "http://host.docker.internal:41001",
        LANGWATCH_ENDPOINT: "https://app.slug.langwatch.localhost",
        LANGWATCH_API_URL: "http://127.0.0.1:41001",
      });
      expect(url).toBe("http://host.docker.internal:41001");
    });
  });

  describe("given no override (the host tier)", () => {
    it("uses LANGWATCH_ENDPOINT", () => {
      expect(
        resolveWorkerCallbackUrl({
          LANGWATCH_ENDPOINT: "https://app.slug.langwatch.localhost",
          LANGWATCH_API_URL: "http://127.0.0.1:41001",
        }),
      ).toBe("https://app.slug.langwatch.localhost");
    });

    it("falls back to LANGWATCH_API_URL when the endpoint is absent", () => {
      expect(
        resolveWorkerCallbackUrl({ LANGWATCH_API_URL: "http://127.0.0.1:41001" }),
      ).toBe("http://127.0.0.1:41001");
    });

    it("returns undefined when nothing is configured", () => {
      expect(resolveWorkerCallbackUrl({})).toBeUndefined();
    });
  });
});

describe("resolveWorkerGatewayBaseUrl", () => {
  describe("given the containerized-worker override is set", () => {
    it("prefers LANGY_WORKER_GATEWAY_URL over the gateway envs", () => {
      const url = resolveWorkerGatewayBaseUrl({
        LANGY_WORKER_GATEWAY_URL: "http://host.docker.internal:45000",
        LW_GATEWAY_PUBLIC_URL: "https://gateway.slug.langwatch.localhost",
        LW_GATEWAY_BASE_URL: "http://127.0.0.1:45000",
      });
      expect(url).toBe("http://host.docker.internal:45000");
    });
  });

  describe("given no override (the host tier)", () => {
    it("uses LW_GATEWAY_PUBLIC_URL, then LW_GATEWAY_BASE_URL", () => {
      expect(
        resolveWorkerGatewayBaseUrl({
          LW_GATEWAY_PUBLIC_URL: "https://gateway.slug.langwatch.localhost",
          LW_GATEWAY_BASE_URL: "http://127.0.0.1:45000",
        }),
      ).toBe("https://gateway.slug.langwatch.localhost");
      expect(
        resolveWorkerGatewayBaseUrl({ LW_GATEWAY_BASE_URL: "http://127.0.0.1:45000" }),
      ).toBe("http://127.0.0.1:45000");
    });

    it("returns undefined when nothing is configured", () => {
      expect(resolveWorkerGatewayBaseUrl({})).toBeUndefined();
    });
  });
});
