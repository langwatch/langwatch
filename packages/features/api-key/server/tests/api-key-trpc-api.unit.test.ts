/**
 * @vitest-environment node
 *
 * The `apiKey.*` tRPC surface itself: the nine procedure names the drawers
 * call, the membership gate that runs inside every one of them before any key
 * is read, the admin gates on the two privileged create paths, the named
 * refusal each failure raises, and — the reason this file exists at all —
 * where key material is allowed to appear.
 *
 * Refusals are asserted by handled `code` and `httpStatus` rather than by tRPC
 * code, because that pair IS what the surface decides: the process's
 * handled-error middleware derives the tRPC code from the status.
 *
 * A minted token is returned exactly once, by `create`. Every read hands back
 * a five-character `lookupIdPrefix` and nothing more, and no audit record
 * carries the secret. Those are the assertions to break loudest.
 *
 * The procedure handed in narrows its own context the way an authenticated
 * process procedure does, so this also pins that a process can hand over a
 * procedure it has already composed.
 */
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyBindingNames,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { ApiKeyApp } from "../src/app/api-key.app";
import { ApiKeyTrpcApi } from "../src/transport/api-trpc/api-key.api";

const USER_ID = "user_1";
const ORG_ID = "org_1";
const ACTIVE_PROJECT_ID = "project_active";
const ARCHIVED_PROJECT_ID = "project_archived";

type TestContext = {
  app: { apiKeys: ApiKeyApp };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

/**
 * The refusal the surface raised, read off the cause tRPC attached rather than
 * off the tRPC code: without the process's handled-error middleware in the
 * chain, every handled error arrives here as the cause of a generic wrapper.
 */
async function expectRefusal(
  call: Promise<unknown>,
  expected: { code: string; httpStatus: number; meta?: Record<string, unknown> },
): Promise<void> {
  await expect(call).rejects.toMatchObject({
    cause: {
      code: expected.code,
      httpStatus: expected.httpStatus,
      ...(expected.meta ? { meta: expected.meta } : {}),
    },
  });
}

function emptyBindingNames(overrides: Partial<ApiKeyBindingNames> = {}): ApiKeyBindingNames {
  return {
    orgName: new Map(),
    teamName: new Map(),
    activeProjectIds: new Set(),
    projectName: new Map(),
    customRoleName: new Map(),
    customRoles: [],
    ...overrides,
  };
}

function storedKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "ak_1",
    name: "Test Key",
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

function harness({ apiKeys = {} }: { apiKeys?: Partial<ApiKeyService> } = {}) {
  const recordAudit = vi.fn();
  const service = {
    ensureCallerIsOrgMember: async () => {},
    isOrgAdmin: async () => false,
    enrichBindingsWithNames: async () => emptyBindingNames(),
    enrichApiKeyList: async () => ({ customRoles: [], users: [] }),
    ...apiKeys,
  } as unknown as ApiKeyService;

  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const router = ApiKeyTrpcApi.create(
    trpc,
    { protected: authenticated, noPermission: () => (procedure) => procedure },
    { recordAudit },
  );

  return {
    recordAudit,
    caller: router.createCaller({
      app: { apiKeys: ApiKeyApp.create({ apiKeys: service }) },
      actor: () => ({ id: USER_ID }),
      session: { user: { id: USER_ID } },
    }),
  };
}

describe("ApiKeyTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the drawers call", () => {
      const trpc = initTRPC.context<TestContext>().create();
      const router = ApiKeyTrpcApi.create(
        trpc,
        { protected: trpc.procedure, noPermission: () => (procedure) => procedure },
        { recordAudit: () => {} },
      );

      expect(Object.keys(router._def.procedures).sort()).toEqual([
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
  });

  describe("when the caller is not a member of the organization", () => {
    /** The membership proof is the authorization here — no permission gates
     *  these procedures — so it must run before anything is read. */
    it("refuses to name a key, without looking one up", async () => {
      const tryGetNameByIdInOrg = vi.fn();
      const { caller } = harness({
        apiKeys: {
          ensureCallerIsOrgMember: async () => {
            throw new ApiKeyNotOwnedError("ak_1");
          },
          tryGetNameByIdInOrg,
        },
      });

      await expectRefusal(caller.nameById({ organizationId: "victim_org", apiKeyId: "ak_1" }), {
        code: "api_key_not_owned",
        httpStatus: 403,
      });
      expect(tryGetNameByIdInOrg).not.toHaveBeenCalled();
    });

    it("refuses to list keys, without reading any", async () => {
      const listAll = vi.fn();
      const list = vi.fn();
      const { caller } = harness({
        apiKeys: {
          ensureCallerIsOrgMember: async () => {
            throw new ApiKeyNotOwnedError("ak_1");
          },
          listAll,
          list,
        },
      });

      await expectRefusal(caller.list({ organizationId: "victim_org" }), {
        code: "api_key_not_owned",
        httpStatus: 403,
      });
      expect(listAll).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    });

    it("refuses to mint a key, without minting one", async () => {
      const create = vi.fn();
      const { caller } = harness({
        apiKeys: {
          ensureCallerIsOrgMember: async () => {
            throw new ApiKeyNotOwnedError("ak_1");
          },
          create,
        },
      });

      await expectRefusal(
        caller.create({ organizationId: "victim_org", name: "Key", bindings: [] }),
        { code: "api_key_not_owned", httpStatus: 403 },
      );
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("given a member asking for one key's name", () => {
    /** @scenario Any organization member can name a key they can already see */
    it("returns the name and revoked flag, and nothing else", async () => {
      const { caller } = harness({
        apiKeys: {
          tryGetNameByIdInOrg: async () => ({
            name: "Claude Code on the laptop",
            revoked: false,
          }),
        },
      });

      const result = await caller.nameById({
        organizationId: ORG_ID,
        apiKeyId: "ak_1",
      });

      expect(result).toEqual({ name: "Claude Code on the laptop", revoked: false });
      expect(Object.keys(result ?? {}).sort()).toEqual(["name", "revoked"]);
    });

    it("scopes the lookup to the organization the caller named", async () => {
      const tryGetNameByIdInOrg = vi.fn(async () => null);
      const { caller } = harness({ apiKeys: { tryGetNameByIdInOrg } });

      await caller.nameById({ organizationId: ORG_ID, apiKeyId: "ak_1" });

      expect(tryGetNameByIdInOrg).toHaveBeenCalledWith({
        id: "ak_1",
        organizationId: ORG_ID,
      });
    });

    /** An unknown id and one belonging to another organization must be
     *  indistinguishable, so probing cannot confirm a key exists elsewhere.
     *  @scenario An unresolvable key id returns nothing rather than an error */
    it("returns null for an id that does not resolve inside the organization", async () => {
      const { caller } = harness({
        apiKeys: { tryGetNameByIdInOrg: async () => null },
      });

      const result = await caller.nameById({
        organizationId: ORG_ID,
        apiKeyId: "key_from_another_org",
      });

      expect(result).toBeNull();
    });
  });

  describe("given a caller with bindings to both an active and an archived project", () => {
    const bindings: ApiKeyBinding[] = [
      {
        id: "rb_1",
        role: "ADMIN",
        customRoleId: null,
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
      {
        id: "rb_2",
        role: "ADMIN",
        customRoleId: null,
        scopeType: "PROJECT",
        scopeId: ACTIVE_PROJECT_ID,
      },
      {
        id: "rb_3",
        role: "ADMIN",
        customRoleId: null,
        scopeType: "PROJECT",
        scopeId: ARCHIVED_PROJECT_ID,
      },
    ];

    const withNames = {
      getUserBindings: async () => bindings,
      enrichBindingsWithNames: async () =>
        emptyBindingNames({
          orgName: new Map([[ORG_ID, "Test Org"]]),
          activeProjectIds: new Set([ACTIVE_PROJECT_ID]),
          projectName: new Map([[ACTIVE_PROJECT_ID, "Active Project"]]),
        }),
    };

    it("excludes bindings to projects that are no longer active", async () => {
      const { caller } = harness({ apiKeys: withNames });

      const result = await caller.myBindings({ organizationId: ORG_ID });

      const projectBindings = result.filter((b) => b.scopeType === "PROJECT");
      expect(projectBindings).toHaveLength(1);
      expect(projectBindings[0]!.scopeId).toBe(ACTIVE_PROJECT_ID);
      expect(result.find((b) => b.scopeId === ARCHIVED_PROJECT_ID)).toBeUndefined();
    });

    it("keeps organization-scoped bindings, named", async () => {
      const { caller } = harness({ apiKeys: withNames });

      const result = await caller.myBindings({ organizationId: ORG_ID });

      const orgBindings = result.filter((b) => b.scopeType === "ORGANIZATION");
      expect(orgBindings).toHaveLength(1);
      expect(orgBindings[0]).toMatchObject({
        scopeId: ORG_ID,
        scopeName: "Test Org",
        customRoleName: null,
      });
    });

    it("reads the caller's own bindings, never another user's", async () => {
      const getUserBindings = vi.fn(async () => bindings);
      const { caller } = harness({
        apiKeys: { ...withNames, getUserBindings },
      });

      await caller.myBindings({ organizationId: ORG_ID });

      expect(getUserBindings).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
    });
  });

  describe("when a member lists API keys", () => {
    it("identifies a key by the first five characters of its lookup id, and never by its secret", async () => {
      const { caller } = harness({
        apiKeys: { list: async () => [storedKey({ lookupId: "abcdefghij" })] },
      });

      const [row] = await caller.list({ organizationId: ORG_ID });

      expect(row!.lookupIdPrefix).toBe("abcde");
      expect(Object.keys(row!)).not.toContain("lookupId");
      expect(JSON.stringify(row)).not.toContain("fghij");
    });

    it("reads only the caller's own keys when they are not an admin", async () => {
      const list = vi.fn(async () => []);
      const listAll = vi.fn(async () => []);
      const { caller } = harness({
        apiKeys: { isOrgAdmin: async () => false, list, listAll },
      });

      await caller.list({ organizationId: ORG_ID });

      expect(list).toHaveBeenCalledWith({ userId: USER_ID, organizationId: ORG_ID });
      expect(listAll).not.toHaveBeenCalled();
    });

    it("reads the whole organization's keys for an admin", async () => {
      const list = vi.fn(async () => []);
      const listAll = vi.fn(async () => []);
      const { caller } = harness({
        apiKeys: { isOrgAdmin: async () => true, list, listAll },
      });

      await caller.list({ organizationId: ORG_ID });

      expect(listAll).toHaveBeenCalledWith({ organizationId: ORG_ID });
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe("when a member mints a key", () => {
    const minted = {
      create: async () => ({
        token: "sk-lw-plaintext-shown-once",
        apiKey: storedKey({ id: "ak_new", name: "Restricted Key" }),
      }),
    };

    /** The one place a plaintext token ever leaves the server. */
    it("returns the plaintext token once, with only the key's identity beside it", async () => {
      const { caller } = harness({ apiKeys: minted });

      const result = await caller.create({
        organizationId: ORG_ID,
        name: "Restricted Key",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(result.token).toBe("sk-lw-plaintext-shown-once");
      expect(Object.keys(result).sort()).toEqual(["apiKey", "token"]);
      expect(Object.keys(result.apiKey).sort()).toEqual(["createdAt", "id", "name"]);
    });

    it("records the mint without the token in the audit arguments", async () => {
      const { caller, recordAudit } = harness({ apiKeys: minted });

      await caller.create({
        organizationId: ORG_ID,
        name: "Restricted Key",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(recordAudit).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: "apiKey.create",
        args: {
          apiKeyId: "ak_new",
          name: "Restricted Key",
          keyType: "personal",
          permissionMode: "all",
          assignedToUserId: USER_ID,
        },
      });
      expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("sk-lw-plaintext-shown-once");
    });

    it("refuses a service key to a non-admin, before minting anything", async () => {
      const create = vi.fn();
      const { caller } = harness({
        apiKeys: { isOrgAdmin: async () => false, create },
      });

      await expectRefusal(
        caller.create({
          organizationId: ORG_ID,
          name: "Service Key",
          keyType: "service",
          bindings: [],
        }),
        {
          code: "api_key_admin_required",
          httpStatus: 403,
          meta: { action: "create-service-key" },
        },
      );
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses to mint a key for another user as a non-admin", async () => {
      const create = vi.fn();
      const { caller } = harness({
        apiKeys: { isOrgAdmin: async () => false, create },
      });

      await expectRefusal(
        caller.create({
          organizationId: ORG_ID,
          name: "Someone else's key",
          assignedToUserId: "user_2",
          bindings: [],
        }),
        {
          code: "api_key_admin_required",
          httpStatus: 403,
          meta: { action: "assign-to-another-user" },
        },
      );
      expect(create).not.toHaveBeenCalled();
    });

    it("mints an unowned key when an admin asks for a service key", async () => {
      const create = vi.fn(async () => ({
        token: "sk-lw-service",
        apiKey: storedKey({ id: "ak_service" }),
      }));
      const { caller } = harness({
        apiKeys: { isOrgAdmin: async () => true, create },
      });

      await caller.create({
        organizationId: ORG_ID,
        name: "Service Key",
        keyType: "service",
        bindings: [],
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null, createdByUserId: USER_ID }),
      );
    });

    /** @scenario Restricted key with camelCase permissions saves without error */
    it("accepts a restricted key with camelCase permissions and a CUSTOM binding", async () => {
      const create = vi.fn(async () => ({
        token: "sk-lw-restricted",
        apiKey: storedKey({ id: "ak_restricted" }),
      }));
      const { caller } = harness({ apiKeys: { create } });

      const result = await caller.create({
        organizationId: ORG_ID,
        name: "Audit Key",
        permissionMode: "restricted",
        permissions: ["auditLog:view"],
        bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(result.apiKey.id).toBe("ak_restricted");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionMode: "restricted",
          permissions: ["auditLog:view"],
        }),
      );
    });

    it("refuses restricted mode without a CUSTOM binding or permissions", async () => {
      const create = vi.fn();
      const { caller } = harness({ apiKeys: { create } });

      await expect(
        caller.create({
          organizationId: ORG_ID,
          name: "Half-restricted",
          permissionMode: "restricted",
          bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a member updates a key", () => {
    it("passes the caller's identity and admin standing to the service", async () => {
      const update = vi.fn(async () => storedKey({ permissionMode: "restricted" }));
      const { caller, recordAudit } = harness({
        apiKeys: { isOrgAdmin: async () => true, update },
      });

      const result = await caller.update({
        organizationId: ORG_ID,
        apiKeyId: "ak_1",
        permissionMode: "restricted",
        permissions: ["traces:view"],
        bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ak_1",
          callerUserId: USER_ID,
          callerIsAdmin: true,
          organizationId: ORG_ID,
        }),
      );
      expect(result).toEqual({
        id: "ak_1",
        name: "Test Key",
        permissionMode: "restricted",
      });
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "apiKey.update" }),
      );
    });
  });

  describe("when a member revokes a key", () => {
    it("revokes it and records the revocation", async () => {
      const revoke = vi.fn(async () => storedKey());
      const { caller, recordAudit } = harness({ apiKeys: { revoke } });

      const result = await caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" });

      expect(result).toEqual({ success: true });
      expect(recordAudit).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: "apiKey.revoke",
        args: { apiKeyId: "ak_1" },
      });
    });

    it("reports an already-revoked key as a conflict, and records nothing", async () => {
      const { caller, recordAudit } = harness({
        apiKeys: {
          revoke: async () => {
            throw new ApiKeyAlreadyRevokedError("ak_1");
          },
        },
      });

      await expectRefusal(caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" }), {
        code: "api_key_already_revoked",
        httpStatus: 409,
      });
      expect(recordAudit).not.toHaveBeenCalled();
    });
  });

  describe("given the service raises a named failure", () => {
    it("lets a missing key through as its own not-found refusal", async () => {
      const { caller } = harness({
        apiKeys: {
          update: async () => {
            throw new ApiKeyNotFoundError("ak_missing");
          },
        },
      });

      await expectRefusal(caller.update({ organizationId: ORG_ID, apiKeyId: "ak_missing" }), {
        code: "api_key_not_found",
        httpStatus: 404,
      });
    });

    it("lets a reserved name through as its own refusal", async () => {
      const { caller } = harness({
        apiKeys: {
          create: async () => {
            throw new ApiKeyReservedNameError("LangWatch CLI");
          },
        },
      });

      await expectRefusal(
        caller.create({
          organizationId: ORG_ID,
          name: "LangWatch CLI",
          bindings: [],
        }),
        { code: "api_key_reserved_name", httpStatus: 422 },
      );
    });

    /** An infrastructure failure is NOT dressed up as a handled one: it leaves
     *  this transport untouched, so the process boundary degrades it to a
     *  generic unknown carrying a trace id (ADR-045). */
    it("rethrows an unhandled failure rather than naming a cause it does not know", async () => {
      const { caller } = harness({
        apiKeys: {
          revoke: async () => {
            throw new Error("ECONNREFUSED 10.0.0.5:5432");
          },
        },
      });

      await expect(caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" })).rejects.toThrow(
        "ECONNREFUSED 10.0.0.5:5432",
      );
    });
  });

  describe("when a non-admin opens the key-assignment picker", () => {
    it("returns no members, without reading the organization's user list", async () => {
      const getOrgMembers = vi.fn();
      const { caller } = harness({
        apiKeys: { isOrgAdmin: async () => false, getOrgMembers },
      });

      expect(await caller.orgMembers({ organizationId: ORG_ID })).toEqual([]);
      expect(getOrgMembers).not.toHaveBeenCalled();
    });
  });
});
