/**
 * The process policy this mount wraps around the package-owned API-key
 * transport. The proof it carries is that mounting changed nothing a caller
 * can observe: the same nine procedure names, the same declared access
 * decision with the same written reason on each one, and — the load-bearing
 * one — that every middleware in the chain sees the VALIDATED input.
 *
 * That last assertion is the whole hazard of this shape. tRPC appends the
 * input parser where `.input()` is called, so a policy composed ahead of it
 * hands the lineage guard, the declared check and the audit row
 * `input === undefined` — and all three then pass while reporting green.
 *
 * The second thing pinned here is credential handling: a minted token reaches
 * the caller and appears in NO audit entry.
 */
import type { ApiKey } from "@langwatch/api-key-contract";
import type { ApiKeyApp } from "@langwatch/api-key-server";
import {
  authzDeclarationOf,
  declareAuthzMiddleware,
  type AuthzDeclaration,
} from "@langwatch/authz-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createApiKeyTrpcRouter } from "../api-key-trpc.mount";

const ORG_ID = "org_api_key_mount";
const USER_ID = "user_api_key_mount";

type TestContext = {
  app: { apiKeys: ApiKeyApp };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

function storedKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "ak_minted",
    name: "Mount Key",
    description: null,
    organizationId: ORG_ID,
    userId: USER_ID,
    createdByUserId: USER_ID,
    createdByDeviceLabel: null,
    lookupId: "abcdefghij",
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    roleBindings: [],
    ...overrides,
  };
}

function declarationsOf(router: unknown): Record<string, AuthzDeclaration | null> {
  const procedures = (router as { _def: { procedures: Record<string, unknown> } })._def.procedures;

  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => {
      const middlewares =
        (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ?? [];
      const declared =
        middlewares
          .map((middleware) => authzDeclarationOf(middleware))
          .find((found) => found !== null) ?? null;
      return [path, declared];
    }),
  );
}

function harness({ apiKeys = {} }: { apiKeys?: Partial<ApiKeyApp> } = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  const recordAudit = vi.fn();
  /** What each middleware in the chain saw, in the order they ran. */
  const seen: { name: string; declaration?: AuthzDeclaration; input: unknown }[] = [];

  /**
   * Stands in for one of the app's middlewares. Recording the `input` each one
   * receives is what makes the ordering rule observable: composed ahead of the
   * feature's `.input()` these would every one record `undefined`.
   */
  const record =
    (name: string, declaration?: AuthzDeclaration) =>
    ({ input, next }: { input: unknown; next: () => Promise<unknown> }) => {
      seen.push({ name, declaration, input });
      return next();
    };

  const middlewares: AppTrpcPolicyMiddlewares = {
    tracer: record("tracer"),
    logger: record("logger"),
    handledError: record("handledError"),
    scopeLineageGuard: (declaration) => record("scopeLineageGuard", declaration),
    // The real one attaches the declaration to the middleware it builds; this
    // stands in for that, so `declarationsOf` reads the same shape the router
    // sweep does.
    declaredCheck: (declaration) =>
      declareAuthzMiddleware(
        declaration,
        record("declaredCheck", declaration) as unknown as (params: never) => Promise<unknown>,
      ),
    enforceCheck: record("enforceCheck"),
    auditMutations: record("auditMutations"),
  };

  const app = { ...apiKeys } as unknown as ApiKeyApp;

  const router = createApiKeyTrpcRouter({
    root: trpc,
    protectedProcedure: trpc.procedure.use(({ ctx, next }) => {
      if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
      return next({ ctx: { session: { user: ctx.session.user } } });
    }),
    middlewares,
    recordAudit,
  });

  return {
    router,
    recordAudit,
    seen,
    caller: router.createCaller({
      app: { apiKeys: app },
      actor: () => ({ id: USER_ID }),
      session: { user: { id: USER_ID } },
    }),
  };
}

describe("API-key transport mount", () => {
  describe("given the mounted router", () => {
    /** @scenario "The API-key transport moves without changing who may call it" */
    it("keeps the legacy procedure names the browser calls", () => {
      const { router } = harness();

      expect(
        Object.keys(
          (router as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
        ).sort(),
      ).toEqual([
        "create",
        "list",
        "myBindings",
        "nameById",
        "orgMembers",
        "orgProjects",
        "orgTeams",
        "revoke",
        "update",
      ]);
    });

    /**
     * No `apiKey:*` permission exists — a personal key belongs to its owner,
     * and the handler proves organization membership itself. Every procedure
     * therefore declares the opt-out WITH the organization id explicitly
     * allowed, which is what keeps the declaration sweep honest.
     * @scenario "The API-key transport moves without changing who may call it"
     */
    it("declares the same access decision, with the same reason, on every procedure", () => {
      const reason =
        "personal API keys are the caller's own; the application proves organization membership and ownership itself";
      const { router } = harness();

      expect(declarationsOf(router)).toEqual({
        myBindings: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "listing caller's own role bindings" },
        },
        nameById: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "naming an API key the caller can already see" },
        },
        list: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "listing API keys" },
        },
        create: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "creating API key for user's own org" },
        },
        update: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "updating API key" },
        },
        revoke: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "revoking API key" },
        },
        orgProjects: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "listing org projects for permission picker" },
        },
        orgTeams: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "listing org teams for scope picker" },
        },
        orgMembers: {
          kind: "no-permission",
          reason,
          allow: { organizationId: "listing org members for key assignment" },
        },
      });
    });
  });

  describe("when a member reads their own bindings", () => {
    /** @scenario "The declared check reads the validated input" */
    it("hands every middleware the organization the validated input named", async () => {
      const { caller, seen } = harness({ apiKeys: { listCallerBindings: async () => [] } });

      await caller.myBindings({ organizationId: ORG_ID });

      expect(seen.map((entry) => entry.name)).toEqual([
        "tracer",
        "logger",
        "handledError",
        "scopeLineageGuard",
        "declaredCheck",
        "enforceCheck",
        "auditMutations",
      ]);
      // Every one of them, not just the first: the policy is applied AFTER the
      // feature's own `.input()`, so none of them can see `undefined`.
      for (const entry of seen) {
        expect(entry.input).toEqual({ organizationId: ORG_ID });
      }
    });
  });

  describe("when a member mints a key", () => {
    it("returns the token to the caller and keeps it out of the audit entry", async () => {
      const { caller, recordAudit } = harness({
        apiKeys: {
          createKey: async () => ({
            token: "sk-lw-plaintext-shown-once",
            apiKey: storedKey(),
            assignedToUserId: USER_ID,
          }),
        },
      });

      const result = await caller.create({
        organizationId: ORG_ID,
        name: "Mount Key",
        bindings: [],
      });

      expect(result.token).toBe("sk-lw-plaintext-shown-once");
      expect(recordAudit).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: "apiKey.create",
        args: {
          apiKeyId: "ak_minted",
          name: "Mount Key",
          keyType: "personal",
          permissionMode: "all",
          assignedToUserId: USER_ID,
        },
      });
      expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("sk-lw-plaintext-shown-once");
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the API-key application runs", async () => {
      const listKeys = vi.fn();
      const { router } = harness({ apiKeys: { listKeys } });
      const caller = router.createCaller({
        app: { apiKeys: { listKeys } as unknown as ApiKeyApp },
        actor: () => ({ id: USER_ID }),
        session: null,
      });

      await expect(caller.list({ organizationId: ORG_ID })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(listKeys).not.toHaveBeenCalled();
    });
  });
});
