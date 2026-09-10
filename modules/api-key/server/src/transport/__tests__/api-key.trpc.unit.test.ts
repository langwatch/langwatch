/**
 * @vitest-environment node
 */

// The `apiKey.*` declared transport, exercised through the real runtime with
// permissive ports: what reaches the application, what the caller is answered,
// what the audit trail records, and which refusals cross the boundary
// unchanged. The authorization DECISIONS themselves (membership first,
// admin-only paths) belong to `ApiKeyApp`; here the app is a stub and the
// transport is the unit under test.

import {
  ApiKeyAdminRequiredError,
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  apiKeyTrpc,
  type ApiKey,
} from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import { apiKeyTrpcTransport } from "../api-key.trpc.ts";
import { apiKeyTrpcCaller, stubApiKeyApi } from "./api-key-trpc.fixture.ts";

const USER_ID = "user_1";
const ORG_ID = "org_1";

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

function harness(app: Parameters<typeof stubApiKeyApi>[0], actor?: { id: string } | null) {
  return apiKeyTrpcCaller({
    declaration: apiKeyTrpcTransport,
    app: stubApiKeyApi(app),
    ...(actor !== undefined ? { actor: actor === null ? null : { type: "user", ...actor } } : {}),
  });
}

describe("the apiKey tRPC transport", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the drawers call", () => {
      const { router } = harness({});

      // tRPC flattens the mounted record into dotted paths: the namespace is
      // part of every procedure's name, and of its React Query cache key.
      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "apiKey.create",
        "apiKey.list",
        "apiKey.myBindings",
        "apiKey.nameById",
        "apiKey.orgMembers",
        "apiKey.orgProjects",
        "apiKey.orgTeams",
        "apiKey.revoke",
        "apiKey.update",
      ]);
    });
  });

  describe("when the caller is anonymous", () => {
    it("refuses before the application runs", async () => {
      const listKeys = vi.fn();
      const { caller } = harness({ listKeys }, null);

      await expect(caller.list({ organizationId: ORG_ID })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(listKeys).not.toHaveBeenCalled();
    });
  });

  describe("when a member reads", () => {
    it("hands the validated input and the caller's identity to the application", async () => {
      const listCallerBindings = vi.fn(async () => []);
      const listKeys = vi.fn(async () => []);
      const findKeyName = vi.fn(async () => null);
      const { caller } = harness({ listCallerBindings, listKeys, findKeyName });

      await caller.myBindings({ organizationId: ORG_ID });
      await caller.list({ organizationId: ORG_ID });
      await caller.nameById({ organizationId: ORG_ID, apiKeyId: "ak_1" });

      expect(listCallerBindings).toHaveBeenCalledWith({ organizationId: ORG_ID }, { id: USER_ID });
      expect(listKeys).toHaveBeenCalledWith({ organizationId: ORG_ID }, { id: USER_ID });
      expect(findKeyName).toHaveBeenCalledWith(
        { organizationId: ORG_ID, apiKeyId: "ak_1" },
        { id: USER_ID },
      );
    });

    it("answers a key name with the name and revoked flag, and nothing else", async () => {
      const { caller } = harness({
        findKeyName: async () => ({ name: "Claude Code on the laptop", revoked: false }),
      });

      const result = await caller.nameById({ organizationId: ORG_ID, apiKeyId: "ak_1" });

      expect(result).toEqual({ name: "Claude Code on the laptop", revoked: false });
      expect(Object.keys(result ?? {}).sort()).toEqual(["name", "revoked"]);
    });

    it("answers null identically for an id that does not resolve", async () => {
      const { caller } = harness({ findKeyName: async () => null });

      expect(
        await caller.nameById({ organizationId: ORG_ID, apiKeyId: "ak_elsewhere" }),
      ).toBeNull();
    });

    it("declares a list answer with no room for the lookup id or any secret", () => {
      const output = apiKeyTrpc.members.list.output;
      const entry = {
        id: "ak_1",
        lookupIdPrefix: "abcde",
        name: "Test Key",
        description: null,
        permissionMode: "all",
        userId: USER_ID,
        userName: null,
        userEmail: null,
        createdByUserId: USER_ID,
        createdByUserName: null,
        createdAt: new Date(),
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        ingestSourceType: null,
        ingestionTemplateId: null,
        createdByDeviceLabel: null,
        roleBindings: [],
      };

      expect(output?.safeParse([entry]).success).toBe(true);
      // Strict by declaration: a row carrying the lookup id — five characters
      // of which are the public prefix — does not fit the wire shape.
      expect(output?.safeParse([{ ...entry, lookupId: "abcdefghij" }]).success).toBe(false);
    });

    it("answers the pickers through the caller-scoped reads", async () => {
      const listOrganizationProjects = vi.fn(async () => []);
      const listOrganizationTeams = vi.fn(async () => []);
      const listOrganizationMembers = vi.fn(async () => []);
      const { caller } = harness({
        listOrganizationProjects,
        listOrganizationTeams,
        listOrganizationMembers,
      });

      await caller.orgProjects({ organizationId: ORG_ID });
      await caller.orgTeams({ organizationId: ORG_ID });
      await caller.orgMembers({ organizationId: ORG_ID });

      for (const read of [
        listOrganizationProjects,
        listOrganizationTeams,
        listOrganizationMembers,
      ]) {
        expect(read).toHaveBeenCalledWith({ organizationId: ORG_ID }, { id: USER_ID });
      }
    });
  });

  describe("when a member mints a key", () => {
    const minted = () => ({
      createKey: vi.fn(async () => ({
        token: "sk-lw-plaintext-shown-once",
        apiKey: storedKey({ id: "ak_new", name: "Restricted Key" }),
        assignedToUserId: USER_ID,
      })),
    });

    /** The one place a plaintext token ever leaves the server. */
    it("returns the plaintext token once, with only the key's identity beside it", async () => {
      const { caller } = harness(minted());

      const result = await caller.create({
        organizationId: ORG_ID,
        name: "Restricted Key",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(result.token).toBe("sk-lw-plaintext-shown-once");
      expect(Object.keys(result).sort()).toEqual(["apiKey", "token"]);
      expect(Object.keys(result.apiKey).sort()).toEqual(["createdAt", "id", "name"]);
    });

    it("applies the declared defaults before the application sees the input", async () => {
      const app = minted();
      const { caller } = harness(app);

      await caller.create({ organizationId: ORG_ID, name: "Key", bindings: [] });

      expect(app.createKey).toHaveBeenCalledWith(
        expect.objectContaining({ permissionMode: "all", keyType: "personal" }),
        { id: USER_ID },
      );
    });

    it("coerces a wire date and strips stray binding fields rather than refusing them", async () => {
      const app = minted();
      const { caller } = harness(app);

      // A named value rather than a literal, so the stray field reaches the
      // parser: the binding schema is deliberately non-strict and strips it.
      const binding = {
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
        stray: true,
      } as const;

      await caller.create({
        organizationId: ORG_ID,
        name: "Key",
        expiresAt: "2027-06-01",
        bindings: [binding],
      });

      const [input] = app.createKey.mock.calls.at(-1)!;
      expect(input.expiresAt).toBeInstanceOf(Date);
      expect(input.bindings).toEqual([
        { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
      ]);
    });

    /** @scenario Restricted key with camelCase permissions saves without error */
    it("accepts a restricted key with camelCase permissions and a CUSTOM binding", async () => {
      const app = minted();
      const { caller } = harness(app);

      await caller.create({
        organizationId: ORG_ID,
        name: "Audit Key",
        permissionMode: "restricted",
        permissions: ["auditLog:view"],
        bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(app.createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionMode: "restricted",
          permissions: ["auditLog:view"],
        }),
        { id: USER_ID },
      );
    });

    it("refuses restricted mode without a CUSTOM binding or permissions, before minting", async () => {
      const app = minted();
      const { caller } = harness(app);

      await expect(
        caller.create({
          organizationId: ORG_ID,
          name: "Half-restricted",
          permissionMode: "restricted",
          bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(app.createKey).not.toHaveBeenCalled();
    });

    it("records the mint in the audit trail without the token anywhere in it", async () => {
      const { caller, audit } = harness(minted());

      await caller.create({
        organizationId: ORG_ID,
        name: "Restricted Key",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0]).toMatchObject({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: "apiKey.create",
        error: undefined,
      });
      expect(audit.entries[0]?.args).toMatchObject({
        name: "Restricted Key",
        keyType: "personal",
        permissionMode: "all",
      });
      expect(JSON.stringify(audit.entries)).not.toContain("sk-lw-plaintext-shown-once");
    });
  });

  describe("when a member updates a key", () => {
    it("answers the key's identity and the mode it now runs under", async () => {
      const updateKey = vi.fn(async () => storedKey({ permissionMode: "restricted" }));
      const { caller, audit } = harness({ updateKey });

      const result = await caller.update({
        organizationId: ORG_ID,
        apiKeyId: "ak_1",
        permissionMode: "restricted",
        permissions: ["traces:view"],
        bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(updateKey).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: "ak_1", organizationId: ORG_ID }),
        { id: USER_ID },
      );
      expect(result).toEqual({ id: "ak_1", name: "Test Key", permissionMode: "restricted" });
      expect(audit.entries.map((entry) => entry.action)).toEqual(["apiKey.update"]);
    });
  });

  describe("when a member revokes a key", () => {
    it("revokes it and records the revocation", async () => {
      const revokeKey = vi.fn(async () => undefined);
      const { caller, audit } = harness({ revokeKey });

      const result = await caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" });

      expect(result).toEqual({ success: true });
      expect(revokeKey).toHaveBeenCalledWith(
        { organizationId: ORG_ID, apiKeyId: "ak_1" },
        { id: USER_ID },
      );
      // One row, and it names the key that was retired: `{ success: true }`
      // carries no target id, so the arguments are the only place the trail
      // can read which credential this was.
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0]).toMatchObject({
        action: "apiKey.revoke",
        args: { organizationId: ORG_ID, apiKeyId: "ak_1" },
      });
    });

    it("records the refusal too when the key was already revoked", async () => {
      const { caller, audit } = harness({
        revokeKey: async () => {
          throw new ApiKeyAlreadyRevokedError("ak_1");
        },
      });

      await expect(
        caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(audit.entries[0]?.action).toBe("apiKey.revoke");
      expect(audit.entries[0]?.error).toBeDefined();
    });
  });

  describe("given the application raises a named failure", () => {
    it("lets a membership refusal through with its own code", async () => {
      const { caller } = harness({
        listKeys: async () => {
          throw new ApiKeyNotOwnedError("ak_1");
        },
      });

      await expect(caller.list({ organizationId: "victim_org" })).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "api_key_not_owned", httpStatus: 403 },
      });
    });

    it("lets an admin-only mint refusal through with its own code", async () => {
      const { caller } = harness({
        createKey: async () => {
          throw new ApiKeyAdminRequiredError("create-service-key");
        },
      });

      await expect(
        caller.create({
          organizationId: ORG_ID,
          name: "Service Key",
          keyType: "service",
          bindings: [],
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: {
          code: "api_key_admin_required",
          httpStatus: 403,
          meta: { action: "create-service-key" },
        },
      });
    });

    it("lets a missing key through as its own not-found refusal", async () => {
      const { caller } = harness({
        updateKey: async () => {
          throw new ApiKeyNotFoundError("ak_missing");
        },
      });

      await expect(
        caller.update({ organizationId: ORG_ID, apiKeyId: "ak_missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", cause: { code: "api_key_not_found" } });
    });

    it("lets a reserved name through as its own refusal", async () => {
      const { caller } = harness({
        createKey: async () => {
          throw new ApiKeyReservedNameError("LangWatch CLI");
        },
      });

      await expect(
        caller.create({ organizationId: ORG_ID, name: "LangWatch CLI", bindings: [] }),
      ).rejects.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        cause: { code: "api_key_reserved_name" },
      });
    });

    /** An infrastructure failure is NOT dressed up as a handled one: it leaves
     *  this transport untouched, so the process boundary degrades it to a
     *  generic unknown carrying a trace id (ADR-045). */
    it("rethrows an unhandled failure rather than naming a cause it does not know", async () => {
      const { caller } = harness({
        revokeKey: async () => {
          throw new Error("ECONNREFUSED 10.0.0.5:5432");
        },
      });

      await expect(caller.revoke({ organizationId: ORG_ID, apiKeyId: "ak_1" })).rejects.toThrow(
        "ECONNREFUSED 10.0.0.5:5432",
      );
    });
  });
});
