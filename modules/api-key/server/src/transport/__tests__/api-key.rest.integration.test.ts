/**
 * The `/api/api-keys` REST door.
 * @see specs/api-keys/api-keys-management-rest-api.feature
 */
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  ApiKeyScopeViolationError,
  LANGY_SESSION_API_KEY_NAME,
  type ApiKey,
  type ApiKeyDetail,
} from "@langwatch/api-key-contract";
import { AuthzPersonalWorkspaceNotManagedHereError } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_ID,
  AS_SERVICE,
  CALLER_USER_ID,
  ORGANIZATION_ID,
  OTHER_USER_ID,
  mountApiKeyRest,
} from "./api-key-rest.harness.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "api-key-1",
    name: "My API Token",
    description: null,
    organizationId: ORGANIZATION_ID,
    userId: CALLER_USER_ID,
    createdByUserId: CALLER_USER_ID,
    createdByDeviceLabel: null,
    lookupId: "lookup-1",
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: NOW,
    updatedAt: NOW,
    roleBindings: [
      {
        id: "binding-1",
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: "team-1",
        customRoleId: null,
      },
    ],
    ...overrides,
  };
}

function apiKeyDetail(overrides: Partial<ApiKeyDetail> = {}): ApiKeyDetail {
  return { ...apiKey(), permissions: [], ...overrides };
}

/** The bindings a personal key must state outright. */
const ORG_ADMIN_BINDING = {
  role: "ADMIN",
  scopeType: "ORGANIZATION",
  scopeId: ORGANIZATION_ID,
} as const;

describe("the api-keys REST family", () => {
  describe("given no credential", () => {
    it("refuses before the request reaches the application", async () => {
      const list = vi.fn(async () => []);
      const { hono } = mountApiKeyRest({ apiKeys: { list } });

      const response = await hono.request("/api/api-keys");

      expect(response.status).toBe(401);
      expect(list).not.toHaveBeenCalled();
    });

    it("refuses a credential it does not recognise", async () => {
      const { send } = mountApiKeyRest();

      expect((await send("/api/api-keys", { as: "sk-lw-invalid_token" })).status).toBe(401);
    });
  });

  describe("given a credential the door refuses the route's permission to", () => {
    it("refuses the mint before the application is asked anything", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({
        apiKeys: { create },
        granted: ["organization:view"],
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: { name: "No Permission", bindings: [ORG_ADMIN_BINDING] },
      });

      expect(response.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a key is minted", () => {
    it("returns the token once, alongside the key's identity", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({
        apiKeys: { create, isOrgAdmin: vi.fn(async () => true) },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: { name: "My API Token", bindings: [ORG_ADMIN_BINDING] },
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        token: "sk-lw-minted",
        apiKey: {
          id: "api-key-1",
          name: "My API Token",
          createdAt: NOW.toISOString(),
        },
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My API Token",
          userId: CALLER_USER_ID,
          createdByUserId: CALLER_USER_ID,
          organizationId: ORGANIZATION_ID,
          bindings: [ORG_ADMIN_BINDING],
        }),
      );
    });

    it("refuses a body with no name, and a personal key with no bindings", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({ apiKeys: { create } });

      const unnamed = await send("/api/api-keys", {
        method: "POST",
        body: { bindings: [ORG_ADMIN_BINDING] },
      });
      const unbound = await send("/api/api-keys", {
        method: "POST",
        body: { name: "No Bindings", bindings: [] },
      });

      expect(unnamed.status).toBe(422);
      expect(unbound.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses restricted mode with no permissions listed", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({ apiKeys: { create } });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "Restricted",
          permissionMode: "restricted",
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
        },
      });

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses projectIds on a personal key, which states its bindings outright", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({ apiKeys: { create } });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "Personal With Projects",
          bindings: [ORG_ADMIN_BINDING],
          projectIds: ["project-1"],
        },
      });

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("names the code when the requested reach is outside the caller's own", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          create: vi.fn(async (): Promise<{ token: string; apiKey: ApiKey }> => {
            throw new ApiKeyScopeViolationError("Scope does not belong to this organization");
          }),
          isOrgAdmin: vi.fn(async () => true),
        },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "Bad Scope",
          bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "nonexistent-org" }],
        },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_scope_violation",
      });
    });

    /** @scenario Creating a key with a reserved name names the code */
    it("names the code rather than the HTTP reason phrase for a reserved name", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          create: vi.fn(async (): Promise<{ token: string; apiKey: ApiKey }> => {
            throw new ApiKeyReservedNameError(LANGY_SESSION_API_KEY_NAME);
          }),
          isOrgAdmin: vi.fn(async () => true),
        },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: { name: LANGY_SESSION_API_KEY_NAME, keyType: "service" },
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_reserved_name",
      });
    });

    it("reads an expiry off the wire as a date", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({ apiKeys: { create } });
      const expiresAt = new Date("2026-09-24T00:00:00.000Z");

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "Expiring Token",
          expiresAt: expiresAt.toISOString(),
          bindings: [ORG_ADMIN_BINDING],
        },
      });

      expect(response.status).toBe(201);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ expiresAt }));
    });

    /**
     * @scenario An API key cannot be bound into a personal workspace
     *
     * Which bindings reach a personal workspace is the authorization writer's
     * rule, pinned where it lives. What matters at this boundary is that its
     * refusal arrives intact — the code, not a generic 500 — because that code
     * is what tells the caller which binding to drop.
     */
    it("carries a personal-workspace refusal through with its own code", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          create: vi.fn(async (): Promise<{ token: string; apiKey: ApiKey }> => {
            throw new AuthzPersonalWorkspaceNotManagedHereError();
          }),
          isOrgAdmin: vi.fn(async () => true),
        },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "personal-bound",
          bindings: [{ role: "ADMIN", scopeType: "TEAM", scopeId: "personal-team" }],
        },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "personal_workspace_not_managed_here",
      });
    });
  });

  describe("given a caller who holds organization:manage but is not an organization admin", () => {
    /** @scenario A manage-permission holder cannot mint an unbound service key */
    it("refuses a service key and mints nothing", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const isOrgAdmin = vi.fn(async () => false);
      const { send } = mountApiKeyRest({ apiKeys: { create, isOrgAdmin } });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: { keyType: "service", name: "svc-escalation" },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_admin_required",
      });
      expect(create).not.toHaveBeenCalled();
      expect(isOrgAdmin).toHaveBeenCalledWith({
        userId: CALLER_USER_ID,
        organizationId: ORGANIZATION_ID,
      });
    });

    it("refuses a key requested on behalf of another member and mints nothing", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({
        apiKeys: { create, isOrgAdmin: vi.fn(async () => false) },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "assigned-by-manager",
          assignedToUserId: OTHER_USER_ID,
          bindings: [ORG_ADMIN_BINDING],
        },
      });

      expect(response.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    });

    it("still mints a personal key for the caller, whose own reach caps it", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const isOrgAdmin = vi.fn(async () => false);
      const { send } = mountApiKeyRest({ apiKeys: { create, isOrgAdmin } });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: { name: "My Own", bindings: [ORG_ADMIN_BINDING] },
      });

      expect(response.status).toBe(201);
      expect(isOrgAdmin).not.toHaveBeenCalled();
    });
  });

  describe("given an organization admin", () => {
    it("mints a service key that no member owns", async () => {
      const create = vi.fn(async () => ({
        token: "sk-lw-minted",
        apiKey: apiKey({ userId: null }),
      }));
      const { send } = mountApiKeyRest({
        apiKeys: { create, isOrgAdmin: vi.fn(async () => true) },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: { keyType: "service", name: "svc-by-admin" },
      });

      expect(response.status).toBe(201);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null, createdByUserId: CALLER_USER_ID, bindings: [] }),
      );
    });

    it("reads a service key's projectIds as one admin binding per project", async () => {
      const create = vi.fn(async () => ({
        token: "sk-lw-minted",
        apiKey: apiKey({ userId: null }),
      }));
      const { send } = mountApiKeyRest({
        apiKeys: { create, isOrgAdmin: vi.fn(async () => true) },
      });

      await send("/api/api-keys", {
        method: "POST",
        body: {
          keyType: "service",
          name: "svc-scoped",
          projectIds: ["project-1", "project-2"],
        },
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          bindings: [
            { role: "ADMIN", scopeType: "PROJECT", scopeId: "project-1" },
            { role: "ADMIN", scopeType: "PROJECT", scopeId: "project-2" },
          ],
        }),
      );
    });

    it("mints a key for another member against that member's own ceiling", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({
        apiKeys: { create, isOrgAdmin: vi.fn(async () => true) },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        body: {
          name: "assigned-by-admin",
          assignedToUserId: OTHER_USER_ID,
          bindings: [ORG_ADMIN_BINDING],
        },
      });

      expect(response.status).toBe(201);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: OTHER_USER_ID,
          createdByUserId: CALLER_USER_ID,
        }),
      );
    });
  });

  describe("given a service credential, which acts as nobody", () => {
    /**
     * Ownerlessness, not `keyType`, is what makes a mint privileged: a credential acting as
     * nobody asking for a "personal" key with no assignment produces the same unowned,
     * org-wide-ADMIN key a service key would, so it takes the same adminness.
     */
    it("resolves its adminness from the credential rather than from a member", async () => {
      const create = vi.fn(async () => ({
        token: "sk-lw-minted",
        apiKey: apiKey({ userId: null }),
      }));
      const isOrgAdmin = vi.fn(async () => true);
      const isOrgAdminApiKey = vi.fn(async () => true);
      const { send } = mountApiKeyRest({ apiKeys: { create, isOrgAdmin, isOrgAdminApiKey } });

      const response = await send("/api/api-keys", {
        method: "POST",
        as: AS_SERVICE,
        body: { keyType: "service", name: "svc-by-service-admin" },
      });

      expect(response.status).toBe(201);
      expect(isOrgAdminApiKey).toHaveBeenCalledWith({
        apiKeyId: API_KEY_ID,
        organizationId: ORGANIZATION_ID,
      });
      expect(isOrgAdmin).not.toHaveBeenCalled();
    });

    it("refuses an unassigned personal key when the credential is not an admin", async () => {
      const create = vi.fn(async () => ({ token: "sk-lw-minted", apiKey: apiKey() }));
      const { send } = mountApiKeyRest({
        apiKeys: { create, isOrgAdminApiKey: vi.fn(async () => false) },
      });

      const response = await send("/api/api-keys", {
        method: "POST",
        as: AS_SERVICE,
        body: { name: "looks-personal", bindings: [ORG_ADMIN_BINDING] },
      });

      expect(response.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when keys are listed", () => {
    it("lists the caller's own keys, without the secret or its lookup id", async () => {
      const list = vi.fn(async () => [apiKey()]);
      const listAll = vi.fn(async () => [apiKey()]);
      const { send } = mountApiKeyRest({ apiKeys: { list, listAll } });

      const response = await send("/api/api-keys");

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith({
        userId: CALLER_USER_ID,
        organizationId: ORGANIZATION_ID,
      });
      expect(listAll).not.toHaveBeenCalled();
      const body = (await response.json()) as { data: Array<Record<string, unknown>> };
      expect(body.data).toEqual([
        {
          id: "api-key-1",
          name: "My API Token",
          description: null,
          createdAt: NOW.toISOString(),
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          roleBindings: [{ id: "binding-1", role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
        },
      ]);
      for (const row of body.data) {
        expect(row).not.toHaveProperty("token");
        expect(row).not.toHaveProperty("hashedSecret");
        expect(row).not.toHaveProperty("lookupId");
      }
    });

    /** @scenario A view-only service credential cannot list every key in the organization */
    it("refuses the org-wide listing to a credential without organization:manage", async () => {
      const listAll = vi.fn(async () => [apiKey()]);
      const { send } = mountApiKeyRest({
        apiKeys: { listAll, credentialCanManageOrganization: vi.fn(async () => false) },
      });

      const response = await send("/api/api-keys", { as: AS_SERVICE });

      expect(response.status).toBe(403);
      expect(listAll).not.toHaveBeenCalled();
    });

    it("returns the org-wide listing to a credential that does hold it", async () => {
      const listAll = vi.fn(async () => [apiKey({ userId: null })]);
      const credentialCanManageOrganization = vi.fn(async () => true);
      const { send } = mountApiKeyRest({
        apiKeys: { listAll, credentialCanManageOrganization },
      });

      const response = await send("/api/api-keys", { as: AS_SERVICE });

      expect(response.status).toBe(200);
      expect(credentialCanManageOrganization).toHaveBeenCalledWith({
        apiKeyId: API_KEY_ID,
        userId: null,
        organizationId: ORGANIZATION_ID,
      });
      expect(listAll).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
    });
  });

  describe("when one key is read by id", () => {
    /** @scenario Fetching an API key returns its bindings */
    it("returns the key's identity, permission mode and bindings in both shapes", async () => {
      const getByIdForCaller = vi.fn(async () =>
        apiKeyDetail({
          description: "Reads the pipeline dashboards",
          permissionMode: "restricted",
          permissions: ["analytics:view", "traces:view"],
        }),
      );
      const { send } = mountApiKeyRest({
        apiKeys: {
          getByIdForCaller,
          isOrgAdmin: vi.fn(async () => true),
          credentialCanManageOrganization: vi.fn(async () => true),
        },
      });

      const response = await send("/api/api-keys/api-key-1");

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: "api-key-1",
        name: "My API Token",
        description: "Reads the pipeline dashboards",
        keyType: "personal",
        assignedToUserId: CALLER_USER_ID,
        createdByUserId: CALLER_USER_ID,
        permissionMode: "restricted",
        permissions: ["analytics:view", "traces:view"],
        bindings: [{ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
        roleBindings: [{ id: "binding-1", role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
      });
      expect(body).not.toHaveProperty("token");
      expect(body).not.toHaveProperty("lookupId");
      expect(body).not.toHaveProperty("hashedSecret");
    });

    it("reports a service key as owned by nobody", async () => {
      const getByIdForCaller = vi.fn(async () => apiKeyDetail({ userId: null }));
      const { send } = mountApiKeyRest({
        apiKeys: { getByIdForCaller, isOrgAdmin: vi.fn(async () => false) },
      });

      const body = (await (await send("/api/api-keys/api-key-1")).json()) as {
        keyType: string;
        assignedToUserId: string | null;
      };

      expect(body.keyType).toBe("service");
      expect(body.assignedToUserId).toBeNull();
    });

    /**
     * Reading somebody else's key by id discloses what the org-wide listing discloses, one row
     * at a time, so it takes the same pair: real adminness AND `organization:manage`.
     */
    it("only widens the read past the caller's own keys when both halves are held", async () => {
      const readWith = async (options: { admin: boolean; manage: boolean }) => {
        // The parameter is declared so `mock.calls[0][0]` exists in the type:
        // a `vi.fn(async () => …)` records its arguments but reports `calls`
        // as the EMPTY tuple, so reading the input the assertion is about was
        // an index out of range to the compiler.
        const getByIdForCaller = vi.fn(
          async (_input: {
            id: string;
            organizationId: string;
            callerUserId: string | null;
            callerCanReadAnyKey: boolean;
          }) => apiKeyDetail(),
        );
        const { send } = mountApiKeyRest({
          apiKeys: {
            getByIdForCaller,
            isOrgAdmin: vi.fn(async () => options.admin),
            credentialCanManageOrganization: vi.fn(async () => options.manage),
          },
        });
        await send("/api/api-keys/api-key-1");
        return getByIdForCaller.mock.calls[0]?.[0];
      };

      await expect(readWith({ admin: true, manage: true })).resolves.toMatchObject({
        callerCanReadAnyKey: true,
      });
      await expect(readWith({ admin: true, manage: false })).resolves.toMatchObject({
        callerCanReadAnyKey: false,
      });
      await expect(readWith({ admin: false, manage: true })).resolves.toMatchObject({
        callerCanReadAnyKey: false,
      });
    });

    /** @scenario Fetching an unknown API key returns not found */
    it("reports an unknown id as not found", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          getByIdForCaller: vi.fn(async (): Promise<ApiKeyDetail> => {
            throw new ApiKeyNotFoundError("api-key-missing");
          }),
          isOrgAdmin: vi.fn(async () => false),
        },
      });

      const response = await send("/api/api-keys/api-key-missing");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "api_key_not_found" });
    });

    /**
     * `getByIdForCaller` throws the SAME `ApiKeyNotFoundError` whether the id
     * is genuinely unknown or names a key that exists but is not visible to
     * this caller — so a real key another member owns cannot be probed for.
     */
    /** @scenario Fetching a key the caller may not read is indistinguishable from an unknown key */
    it("answers a real key the caller may not read the same way as an unknown id", async () => {
      const notFound = async (): Promise<ApiKeyDetail> => {
        throw new ApiKeyNotFoundError("api-key-1");
      };
      const { send: sendUnreachable } = mountApiKeyRest({
        apiKeys: { getByIdForCaller: vi.fn(notFound), isOrgAdmin: vi.fn(async () => false) },
      });
      const { send: sendUnknown } = mountApiKeyRest({
        apiKeys: { getByIdForCaller: vi.fn(notFound), isOrgAdmin: vi.fn(async () => false) },
      });

      const unreachable = await sendUnreachable("/api/api-keys/api-key-1");
      const unknown = await sendUnknown("/api/api-keys/api-key-missing");

      expect(unreachable.status).toBe(unknown.status);
      expect(unreachable.status).toBe(404);
      const [unreachableBody, unknownBody] = await Promise.all([
        unreachable.json(),
        unknown.json(),
      ]);
      expect(unreachableBody).toEqual(unknownBody);
      expect(unreachableBody).toMatchObject({ error: "api_key_not_found" });
    });
  });

  describe("when a key is edited", () => {
    /** @scenario Renaming an API key preserves its bindings */
    it("reads the key back through the same path the fetch serves", async () => {
      const update = vi.fn(async () => apiKey({ name: "rename-after" }));
      const getByIdForCaller = vi.fn(async () => apiKeyDetail({ name: "rename-after" }));
      const { send } = mountApiKeyRest({
        apiKeys: { update, getByIdForCaller, isOrgAdmin: vi.fn(async () => true) },
      });

      const response = await send("/api/api-keys/api-key-1", {
        method: "PATCH",
        body: { name: "rename-after" },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { name: string; bindings: unknown[] };
      expect(body.name).toBe("rename-after");
      expect(body.bindings).toEqual([{ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }]);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "api-key-1",
          callerUserId: CALLER_USER_ID,
          callerIsAdmin: true,
          organizationId: ORGANIZATION_ID,
          name: "rename-after",
        }),
      );
      expect(getByIdForCaller).toHaveBeenCalledWith(
        expect.objectContaining({ id: "api-key-1", callerCanReadAnyKey: true }),
      );
    });

    /** @scenario Replacing bindings with a tighter set takes effect */
    it("sends the replacement bindings through as they arrived", async () => {
      const update = vi.fn(async () => apiKey());
      const { send } = mountApiKeyRest({
        apiKeys: {
          update,
          getByIdForCaller: vi.fn(async () => apiKeyDetail()),
          isOrgAdmin: vi.fn(async () => true),
        },
      });

      await send("/api/api-keys/api-key-1", {
        method: "PATCH",
        body: {
          bindings: [{ role: "VIEWER", scopeType: "PROJECT", scopeId: "project-1" }],
        },
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          bindings: [{ role: "VIEWER", scopeType: "PROJECT", scopeId: "project-1" }],
        }),
      );
    });

    /** @scenario Setting restricted mode requires explicit permissions */
    it("refuses restricted mode with no permissions and writes nothing", async () => {
      const update = vi.fn(async () => apiKey());
      const { send } = mountApiKeyRest({ apiKeys: { update } });

      const response = await send("/api/api-keys/api-key-1", {
        method: "PATCH",
        body: { permissionMode: "restricted" },
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
      expect(update).not.toHaveBeenCalled();
    });

    /** @scenario Widening a key beyond the caller's own access is refused */
    it("names the scope violation the application refused", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          update: vi.fn(async (): Promise<ApiKey> => {
            throw new ApiKeyScopeViolationError("Beyond the owner's access");
          }),
          isOrgAdmin: vi.fn(async () => false),
        },
      });

      const response = await send("/api/api-keys/api-key-1", {
        method: "PATCH",
        body: {
          bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "project-1" }],
        },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_scope_violation",
      });
    });

    /**
     * A 403 here would confirm the id names a real key, which is exactly what
     * the fetch refuses to confirm. The two answers have to agree.
     */
    it("reports a key the caller does not own as not found, not forbidden", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          update: vi.fn(async (): Promise<ApiKey> => {
            throw new ApiKeyNotOwnedError("api-key-1");
          }),
          isOrgAdmin: vi.fn(async () => false),
        },
      });

      const response = await send("/api/api-keys/api-key-1", {
        method: "PATCH",
        body: { name: "foreign-edit-renamed" },
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "api_key_not_found" });
    });
  });

  describe("when a key is revoked", () => {
    it("answers success and hands the application the caller's real adminness", async () => {
      const revoke = vi.fn(async () => apiKey({ revokedAt: NOW }));
      const isOrgAdmin = vi.fn(async () => true);
      const { send } = mountApiKeyRest({ apiKeys: { revoke, isOrgAdmin } });

      const response = await send("/api/api-keys/api-key-1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(revoke).toHaveBeenCalledWith({
        id: "api-key-1",
        callerUserId: CALLER_USER_ID,
        callerIsAdmin: true,
        organizationId: ORGANIZATION_ID,
      });
    });

    /** @scenario Deleting another user's key requires organization admin rights */
    it("tells the application the caller is not an admin, so it can refuse", async () => {
      const revoke = vi.fn(async (): Promise<ApiKey> => {
        throw new ApiKeyNotOwnedError("api-key-1");
      });
      const { send } = mountApiKeyRest({
        apiKeys: { revoke, isOrgAdmin: vi.fn(async () => false) },
      });

      const response = await send("/api/api-keys/api-key-1", { method: "DELETE" });

      expect(response.status).toBe(403);
      expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ callerIsAdmin: false }));
    });

    /** @scenario Revoking a key that is already revoked names the code */
    it("names the code rather than the HTTP reason phrase", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          revoke: vi.fn(async (): Promise<ApiKey> => {
            throw new ApiKeyAlreadyRevokedError("api-key-1");
          }),
          isOrgAdmin: vi.fn(async () => true),
        },
      });

      const response = await send("/api/api-keys/api-key-1", { method: "DELETE" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_already_revoked",
      });
    });

    it("reports an unknown id as not found", async () => {
      const { send } = mountApiKeyRest({
        apiKeys: {
          revoke: vi.fn(async (): Promise<ApiKey> => {
            throw new ApiKeyNotFoundError("nonexistent-key-id");
          }),
          isOrgAdmin: vi.fn(async () => true),
        },
      });

      expect(
        (await send("/api/api-keys/nonexistent-key-id", { method: "DELETE" })).status,
      ).toBe(404);
    });
  });
});
