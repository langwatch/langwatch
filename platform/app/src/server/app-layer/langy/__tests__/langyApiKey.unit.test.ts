/**
 * @vitest-environment node
 *
 * Unit tests for mintLangySessionApiKey — the per-chat-session, caller-scoped
 * Langy key (ADR-047). The two boundaries are mocked: batchProjectPermissions
 * (what the user holds) and ApiKeyService.create (the mint). These tests pin
 * the contract that the minted key is OWNED BY THE USER, RESTRICTED,
 * PROJECT-scoped, EXPIRING, and carries EXACTLY the intersection of the Langy
 * candidate permissions with what the user actually holds — nothing more.
 *
 * Spec: specs/langy/langy-session-key.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^enc:/, "")),
}));

const batchProjectPermissions = vi.fn();
// Partial mock: only the permission resolver is stubbed. The REAL
// `Resources`/`Actions`/`isOrgExclusivePermission` must come through, because
// `langyPermissionPolicy.ts` derives the candidate list from them at import
// time — a stub there would silently shrink the very list this file tests.
vi.mock("~/server/api/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/rbac")>()),
  batchProjectPermissions: (...args: unknown[]) =>
    batchProjectPermissions(...args),
}));

const apiKeyCreate = vi.fn();
vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: {
    create: vi.fn(() => ({ create: apiKeyCreate })),
  },
}));

import {
  LANGY_CANDIDATE_PERMISSIONS,
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
  reapExpiredLangySessionApiKeys,
  revokeLangySessionApiKey,
} from "../langyApiKey";

const SESSION = { user: { id: "user-1" }, expires: "1" } as any;
// The mint resolves the project's team once (a TEAM binding inherits to its
// projects) and hands it to the batched resolution.
const prisma = {
  project: { findUnique: vi.fn().mockResolvedValue({ teamId: "team-1" }) },
} as any;

// The full candidate surface, in declaration order — used to assert the "all
// permissions held" case grants exactly this set. The REAL derived list, not a
// hand-copy: the mint's job under test is the intersection and the key's
// shape, and pinning a duplicate of the list here would make every deliberate
// policy change fail twice for one decision. The list's own CONTENT is pinned
// where it is decided — `langy-permission-coverage.unit.test.ts` asserts the
// boundaries (secrets absent, auth-scope writes absent, data-family CRUD
// present) against `langyPermissionPolicy.ts`.
const ALL_CANDIDATES = [...LANGY_CANDIDATE_PERMISSIONS];

beforeEach(() => {
  batchProjectPermissions.mockReset();
  apiKeyCreate.mockReset();
  apiKeyCreate.mockResolvedValue({
    token: "sk-lw-minted",
    apiKey: { id: "k1" },
  });
});

describe("mintLangySessionApiKey", () => {
  describe("given a user who holds every Langy permission", () => {
    describe("when a session key is minted", () => {
      it("requests a restricted, user-owned, project-scoped, expiring key with the full held set", async () => {
        batchProjectPermissions.mockResolvedValue(ALL_CANDIDATES);

        const { token, apiKeyId } = await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        expect(token).toBe("sk-lw-minted");
        // The id comes back so the agent manager can REVOKE this key when the
        // worker carrying it dies — the only handle it ever gets.
        expect(apiKeyId).toBe("k1");
        expect(apiKeyCreate).toHaveBeenCalledTimes(1);

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        // OWNED by the caller → their permissions are the ceiling.
        expect(arg.userId).toBe("user-1");
        expect(arg.createdByUserId).toBe("user-1");
        expect(arg.organizationId).toBe("org-1");
        expect(arg.permissionMode).toBe("restricted");
        // PROJECT-scoped CUSTOM binding only — never org/team.
        expect(arg.bindings).toEqual([
          { role: "CUSTOM", scopeType: "PROJECT", scopeId: "proj-1" },
        ]);
        // The full held set == every candidate permission, in order.
        expect(arg.permissions).toEqual(ALL_CANDIDATES);
        // Ephemeral: a future expiry so a leaked key auto-lapses.
        expect(arg.expiresAt).toBeInstanceOf(Date);
        expect(arg.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("given a user who holds only a subset of Langy's permissions", () => {
    describe("when a session key is minted", () => {
      it("requests EXACTLY that subset and nothing the user lacks", async () => {
        // Holds prompts (view/create/update) + datasets:view only. Everything
        // else — including any trigger action — is denied.
        const held = new Set([
          "prompts:view",
          "prompts:create",
          "prompts:update",
          "datasets:view",
        ]);
        // The batched resolution returns the held subset, in candidate order.
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(args.permissions.filter((p) => held.has(p))),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        // Candidate order: datasets (family 3) precedes prompts (family 7).
        expect(arg.permissions).toEqual([
          "datasets:view",
          "prompts:view",
          "prompts:create",
          "prompts:update",
        ]);
        // Concretely: the user can't create triggers, so the key can't either —
        // even though the old shared key could.
        expect(arg.permissions).not.toContain("triggers:create");
      });

      it("resolves every candidate in ONE batched call, not one check per candidate", async () => {
        batchProjectPermissions.mockResolvedValue(ALL_CANDIDATES);

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        // This is a REGRESSION TEST, not a style preference. Issuing one scoped
        // check per candidate meant ~3 queries x 27 candidates on every chat
        // turn. Serially that was ~500ms; concurrently it demanded ~81 Prisma
        // connections at once, starved the pool, and made the interactive
        // transaction inside ApiKeyService.create blow its 5s budget — the turn
        // died with a 409. The count is the contract: ONE.
        expect(batchProjectPermissions).toHaveBeenCalledTimes(1);

        // ...still carrying the caller's own session and project, which is what
        // clamps the key to the human.
        expect(batchProjectPermissions).toHaveBeenCalledWith(
          { prisma, session: SESSION },
          expect.objectContaining({
            organizationId: "org-1",
            projectId: "proj-1",
            teamId: "team-1",
            permissions: ALL_CANDIDATES,
          }),
        );
      });
    });
  });

  // The key asks for `scenarios:create`, so a user who can manage scenarios
  // must come out holding it — `:manage` implies `:create` through the RBAC
  // hierarchy, and the key is what the ROUTE then checks against.
  describe("given a user who can manage a resource", () => {
    describe("when a session key is minted", () => {
      it("carries the finer grants that management implies", async () => {
        // What `batchProjectPermissions` returns for a manage-holder: every
        // candidate in that family, resolved through the hierarchy.
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(
              args.permissions.filter((p) => p.startsWith("scenarios:")),
            ),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        expect(arg.permissions).toContain("scenarios:create");
      });

      it("reaches the manage grain on data families, and never on the auth scope", async () => {
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(args.permissions),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        // Owner decision, 2026-08-21: full CRUD on tenant data. The old
        // assertion here was the inverse — no `:manage`/`:delete` anywhere —
        // which enforced a default that had hardened into doctrine. The
        // ceiling that actually protects the user is the intersection with
        // their own permissions, exercised by the subset tests above.
        expect(arg.permissions).toContain("scenarios:manage");
        expect(arg.permissions).toContain("datasets:delete");
        // The line that remains: no write grain on a family whose writes
        // change who-can-do-what or a credential.
        expect(
          (arg.permissions as string[]).filter((p) => {
            const family = p.split(":")[0]!;
            return (
              [
                "organization",
                "team",
                "project",
                "virtualKeys",
                "gatewayProviders",
                "webhookEndpoints",
                "auditLog",
                "complianceExport",
              ].includes(family) && !p.endsWith(":view")
            );
          }),
        ).toEqual([]);
      });
    });
  });

  describe("given a user who can only view that resource", () => {
    describe("when a session key is minted", () => {
      it("asks for the view and never the write", async () => {
        const held = new Set(["scenarios:view"]);
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(args.permissions.filter((p) => held.has(p))),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        expect(arg.permissions).toEqual(["scenarios:view"]);
      });
    });
  });

  // The candidate list bounds what Langy can EVER touch. Widening it to full
  // tenant-data CRUD must not have widened it across the owner's three
  // carve-outs: secrets, auth-scope writes, ceiling-escaping actions.
  describe("given an admin who holds everything in the organization", () => {
    describe("when a session key is minted", () => {
      it("never asks for secrets, auth-scope writes, or public trace sharing", async () => {
        // The user holds literally every permission asked about.
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(args.permissions),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        const permissions = arg.permissions as string[];
        // Secrets: not even the read.
        expect(permissions.filter((p) => p.startsWith("secrets:"))).toEqual(
          [],
        );
        // Auth scope: reads only. (The reads themselves ARE expected — that
        // half of the rule lives in the coverage test's boundary block.)
        for (const family of [
          "organization",
          "team",
          "virtualKeys",
          "gatewayProviders",
          "auditLog",
        ]) {
          expect(
            permissions.filter(
              (p) => p.startsWith(`${family}:`) && !p.endsWith(":view"),
            ),
          ).toEqual([]);
        }
        // Ceiling-escaping actions, on any family.
        expect(permissions).not.toContain("traces:share");
        expect(permissions).not.toContain("virtualKeys:rotate");
        // And the widening is real, not vacuous: full CRUD arrived.
        expect(permissions).toContain("traces:manage");
        expect(permissions).toContain("gatewayBudgets:manage");
      });

      // `project` is the one family Langy reaches outside its nine, and only to
      // READ: the project-shaped surfaces (agents, model providers, model
      // defaults) have no family of their own. The writes in that family are
      // the credential surface — `project:update` stores model-provider keys,
      // `project:manage` regenerates the project's API key — so the candidate
      // list must never reach past the view.
      it("reads the project but never writes to it", async () => {
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(args.permissions),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        const projectPermissions = (arg.permissions as string[]).filter((p) =>
          p.startsWith("project:"),
        );
        expect(projectPermissions).toEqual(["project:view"]);
      });

      // Triggers and experiments were the two families the old policy held to
      // read-only, each with a written rationale (durable standing
      // instructions; a manage-only write surface). Both rationales were
      // policy defaults, not product boundaries, and the owner's 2026-08-21
      // rule supersedes them: tenant data is fully operable. This pin is what
      // proves the supersession actually reached the key.
      it("carries the full write surface on the formerly read-only families", async () => {
        batchProjectPermissions.mockImplementation(
          (_ctx: unknown, args: { permissions: string[] }) =>
            Promise.resolve(args.permissions),
        );

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        const arg = apiKeyCreate.mock.calls[0]![0] as Record<string, any>;
        for (const permission of [
          "triggers:create",
          "triggers:update",
          "triggers:manage",
          "experiments:manage",
          "evaluations:manage",
          "evaluations:delete",
        ]) {
          expect(arg.permissions).toContain(permission);
        }
      });
    });
  });

  describe("given a user who holds none of Langy's permissions", () => {
    describe("when a session key is minted", () => {
      it("throws LangySessionKeyScopeError and never mints a key", async () => {
        batchProjectPermissions.mockResolvedValue([]);

        await expect(
          mintLangySessionApiKey({
            prisma,
            session: SESSION,
            projectId: "proj-1",
            organizationId: "org-1",
          }),
        ).rejects.toBeInstanceOf(LangySessionKeyScopeError);

        expect(apiKeyCreate).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * The manager can ask us to revoke a key. It must NEVER be able to use that to
 * take down anything other than its own worker's session key — this is the
 * narrowness that keeps a revoke-only callback fail-closed instead of turning the
 * internal secret into a "disable any customer's API key" button.
 */
describe("revokeLangySessionApiKey", () => {
  const keyPrisma = (key: unknown) =>
    ({
      apiKey: {
        findUnique: vi.fn().mockResolvedValue(key),
        update: vi.fn().mockResolvedValue({}),
      },
    }) as any;

  describe("given the id names a Langy session key", () => {
    describe("when the manager reports its worker died", () => {
      it("revokes it", async () => {
        const p = keyPrisma({
          id: "k1",
          name: "Langy session",
          revokedAt: null,
          // The PROJECT-scoped binding the mint gave it — the tenant anchor.
          roleBindings: [{ id: "rb1" }],
        });

        await expect(
          revokeLangySessionApiKey({
            prisma: p,
            apiKeyId: "k1",
            projectId: "p1",
          }),
        ).resolves.toBe("revoked");

        expect(p.apiKey.update).toHaveBeenCalledWith({
          where: { id: "k1" },
          data: { revokedAt: expect.any(Date) },
        });
      });
    });
  });

  describe("given the id names a key that is NOT a Langy session key", () => {
    describe("when revocation is requested", () => {
      it("refuses and leaves the key untouched", async () => {
        // A customer's own key. Even with a valid internal secret and a real id,
        // the manager must not be able to revoke this.
        const p = keyPrisma({
          id: "k2",
          name: "Production ingestion key",
          revokedAt: null,
          roleBindings: [{ id: "rb2" }],
        });

        await expect(
          revokeLangySessionApiKey({
            prisma: p,
            apiKeyId: "k2",
            projectId: "p1",
          }),
        ).resolves.toBe("refused");

        expect(p.apiKey.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a Langy session key scoped to a DIFFERENT project", () => {
    describe("when a caller holding the internal secret targets it by id", () => {
      it("refuses as not-found so a cross-tenant id is never confirmed", async () => {
        // The Prisma binding filter finds no PROJECT-scoped binding for this
        // project, so the select returns an empty roleBindings array.
        const p = keyPrisma({
          id: "k5",
          name: "Langy session",
          revokedAt: null,
          roleBindings: [],
        });

        await expect(
          revokeLangySessionApiKey({
            prisma: p,
            apiKeyId: "k5",
            projectId: "other-project",
          }),
        ).resolves.toBe("not_found");

        expect(p.apiKey.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the key is already revoked or gone", () => {
    describe("when revocation is requested again", () => {
      it("is idempotent — the manager races the reaper, and losing is not a fault", async () => {
        const already = keyPrisma({
          id: "k3",
          name: "Langy session",
          revokedAt: new Date(),
          roleBindings: [{ id: "rb3" }],
        });
        await expect(
          revokeLangySessionApiKey({
            prisma: already,
            apiKeyId: "k3",
            projectId: "p1",
          }),
        ).resolves.toBe("already_revoked");
        expect(already.apiKey.update).not.toHaveBeenCalled();

        const gone = keyPrisma(null);
        await expect(
          revokeLangySessionApiKey({
            prisma: gone,
            apiKeyId: "k4",
            projectId: "p1",
          }),
        ).resolves.toBe("not_found");
        expect(gone.apiKey.update).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * The reaper is the GUARANTEE, not a nicety. A manager that is SIGKILLed runs no
 * cleanup, so every key its workers held stays valid for the rest of its TTL — no
 * callback can close that, because the process that would make the call is the one
 * that died.
 */
describe("reapExpiredLangySessionApiKeys", () => {
  describe("given Langy session keys whose lifetime has elapsed", () => {
    describe("when the reaper runs", () => {
      // Prisma is fully mocked here, so the org-tenancy middleware
      // (`prisma.$use(guardOrganizationId)`) never runs — this covers the query
      // SHAPE only. That the guard admits that shape is covered by
      // `utils/__tests__/dbOrganizationIdProtection.unit.test.ts`, which drives
      // this same function through the real middleware.
      it("revokes exactly the expired, unrevoked Langy session keys", async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 3 });
        const p = { apiKey: { updateMany } } as any;
        const now = new Date("2026-07-11T12:00:00Z");

        await expect(
          reapExpiredLangySessionApiKeys({ prisma: p, now }),
        ).resolves.toBe(3);

        expect(updateMany).toHaveBeenCalledWith({
          where: {
            name: "Langy session",
            revokedAt: null,
            expiresAt: { not: null, lte: now },
          },
          data: { revokedAt: now },
        });
      });
    });
  });
});
