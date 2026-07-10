/**
 * @vitest-environment node
 *
 * Unit tests for mintLangySessionApiKey — the per-chat-session, caller-scoped
 * Langy key (ADR-047). The two boundaries are mocked: hasProjectPermission
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

const hasProjectPermission = vi.fn();
vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) => hasProjectPermission(...args),
}));

const apiKeyCreate = vi.fn();
vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: {
    create: vi.fn(() => ({ create: apiKeyCreate })),
  },
}));

import {
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
} from "../langyApiKey";

const SESSION = { user: { id: "user-1" }, expires: "1" } as any;
const prisma = {} as any;

// The full candidate surface, in declaration order — used to assert the "all
// permissions held" case grants exactly this set.
const ALL_CANDIDATES = [
  "traces:view",
  "traces:create",
  "traces:update",
  "evaluations:view",
  "evaluations:create",
  "evaluations:update",
  "datasets:view",
  "datasets:create",
  "datasets:update",
  "scenarios:view",
  "scenarios:create",
  "scenarios:update",
  "annotations:view",
  "annotations:create",
  "annotations:update",
  "analytics:view",
  "analytics:create",
  "analytics:update",
  "prompts:view",
  "prompts:create",
  "prompts:update",
  "triggers:view",
  "triggers:create",
  "triggers:update",
  "workflows:view",
  "workflows:create",
  "workflows:update",
];

beforeEach(() => {
  hasProjectPermission.mockReset();
  apiKeyCreate.mockReset();
  apiKeyCreate.mockResolvedValue({ token: "sk-lw-minted", apiKey: { id: "k1" } });
});

describe("mintLangySessionApiKey", () => {
  describe("given a user who holds every Langy permission", () => {
    describe("when a session key is minted", () => {
      it("requests a restricted, user-owned, project-scoped, expiring key with the full held set", async () => {
        hasProjectPermission.mockResolvedValue(true);

        const token = await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        expect(token).toBe("sk-lw-minted");
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
        hasProjectPermission.mockImplementation(
          (_ctx: unknown, _projectId: string, perm: string) =>
            Promise.resolve(held.has(perm)),
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

      it("probes each candidate permission against the caller's session and project", async () => {
        hasProjectPermission.mockResolvedValue(true);

        await mintLangySessionApiKey({
          prisma,
          session: SESSION,
          projectId: "proj-1",
          organizationId: "org-1",
        });

        // One probe per candidate, all carrying the caller's own session +
        // project — this is what clamps the key to the human.
        expect(hasProjectPermission).toHaveBeenCalledTimes(ALL_CANDIDATES.length);
        expect(hasProjectPermission).toHaveBeenCalledWith(
          { prisma, session: SESSION },
          "proj-1",
          "prompts:update",
        );
      });
    });
  });

  describe("given a user who holds none of Langy's permissions", () => {
    describe("when a session key is minted", () => {
      it("throws LangySessionKeyScopeError and never mints a key", async () => {
        hasProjectPermission.mockResolvedValue(false);

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
