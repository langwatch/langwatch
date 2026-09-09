/**
 * The process mount wrapped around the package-owned API-key transport: the
 * nine names, their written no-permission declarations, and the audit rows.
 */

// What is pinned here:
//   - every procedure still carries its no-permission declaration with the
//     organization id explicitly allowed;
//   - the automatic mutation row records the VALIDATED input (a default the
//     caller omitted proves the parser ran first);
//   - the mount adds the curated audit entry, because the automatic row's
//     generic redaction masks `apiKeyId` and `revoke`'s answer carries no id;
//   - the minted token reaches the caller while appearing in NO audit entry.

import {
  ApiKeyAlreadyRevokedError,
  type ApiKey,
  type ApiKeyApi,
} from "@langwatch/api-key-contract";
import type { TrpcRuntimeAuditEntry, TrpcRuntimePorts } from "@langwatch/api/trpc";
import { createTrpcRuntime, redactAuditArgs } from "@langwatch/api/trpc";
import { authzDeclarationOf, type AuthzDeclaration } from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { createApiKeyTrpcRouter } from "../api-key-trpc.mount.ts";

const ORG_ID = "org_api_key_mount";
const USER_ID = "user_api_key_mount";

type TestContext = {
  app: { apiKeys: ApiKeyApi };
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

function harness({
  apiKeys = {},
  anonymous = false,
}: { apiKeys?: Partial<ApiKeyApi>; anonymous?: boolean } = {}) {
  const root = initTRPC.context<TestContext>().create();
  const recordAudit = vi.fn();
  const audit = { entries: [] as TrpcRuntimeAuditEntry[] };

  const ports: TrpcRuntimePorts<TestContext> = {
    identity: {
      caller: () => ({ actor: anonymous ? null : { type: "user", id: USER_ID } }),
    },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: {
      record: async (entry) => {
        audit.entries.push(entry);
      },
      // The REAL redaction, so what this test asserts is what the trail keeps.
      redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
      exempt: () => false,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  const runtime = createTrpcRuntime<TestContext>({ root, procedure: root.procedure, ports });
  const router = createApiKeyTrpcRouter({ runtime, recordAudit });

  return {
    router,
    recordAudit,
    audit,
    caller: root.router({ apiKey: router }).createCaller({
      app: { apiKeys: apiKeys as ApiKeyApi },
    }).apiKey,
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

  describe("when a member mints a key", () => {
    const minting = {
      createKey: async () => ({
        token: "sk-lw-plaintext-shown-once",
        apiKey: storedKey(),
        assignedToUserId: USER_ID,
      }),
    };

    it("returns the token to the caller and keeps it out of every audit entry", async () => {
      const { caller, recordAudit, audit } = harness({ apiKeys: minting });

      const result = await caller.create({
        organizationId: ORG_ID,
        name: "Mount Key",
        bindings: [],
      });

      expect(result.token).toBe("sk-lw-plaintext-shown-once");
      expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("sk-lw-plaintext-shown-once");
      expect(JSON.stringify(audit.entries)).not.toContain("sk-lw-plaintext-shown-once");
    });

    it("records the curated entry the mint has always written", async () => {
      const { caller, recordAudit } = harness({ apiKeys: minting });

      await caller.create({
        organizationId: ORG_ID,
        name: "Mount Key",
        bindings: [],
      });

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
    });

    it("records the automatic row over the VALIDATED input, defaults applied", async () => {
      const { caller, audit } = harness({ apiKeys: minting });

      // No keyType on the wire: the default reaching the audit row is the
      // proof the parser ran before the audit middleware read the input.
      await caller.create({ organizationId: ORG_ID, name: "Mount Key", bindings: [] });

      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0]).toMatchObject({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: "apiKey.create",
        error: undefined,
      });
      expect(audit.entries[0]?.args).toMatchObject({ keyType: "personal", permissionMode: "all" });
    });
  });

  describe("when a member revokes a key", () => {
    it("records the curated entry naming the key the automatic row cannot", async () => {
      const { caller, recordAudit, audit } = harness({ apiKeys: { revokeKey: async () => {} } });

      const result = await caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" });

      expect(result).toEqual({ success: true });
      expect(recordAudit).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: "apiKey.revoke",
        args: { apiKeyId: "ak_1" },
      });
      // The automatic row beside it: the generic redaction masks `apiKeyId`,
      // and `{ success: true }` yields no target id — which is exactly the gap
      // the curated entry above fills.
      expect(audit.entries[0]).toMatchObject({
        action: "apiKey.revoke",
        args: { organizationId: ORG_ID, apiKeyId: "[redacted]" },
        targetId: undefined,
      });
    });

    it("records no curated entry for a refusal, and the automatic row carries the failure", async () => {
      const { caller, recordAudit, audit } = harness({
        apiKeys: {
          revokeKey: async () => {
            throw new ApiKeyAlreadyRevokedError("ak_1");
          },
        },
      });

      await expect(
        caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(recordAudit).not.toHaveBeenCalled();
      expect(audit.entries[0]?.action).toBe("apiKey.revoke");
      expect(audit.entries[0]?.error).toBeDefined();
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the API-key application runs", async () => {
      const listKeys = vi.fn();
      const { caller } = harness({ apiKeys: { listKeys }, anonymous: true });

      await expect(caller.list({ organizationId: ORG_ID })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(listKeys).not.toHaveBeenCalled();
    });
  });
});
