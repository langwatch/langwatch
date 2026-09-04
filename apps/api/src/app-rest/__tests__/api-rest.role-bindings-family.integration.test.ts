/**
 * The role-bindings REST family (`/api/role-bindings`), driven through the
 * real Hono app `createApiProcessRestFeatures` returns.
 *
 * The route itself is thin: every business rule (principal exclusivity,
 * cross-organization checks, org-exclusive-permission scope fencing, the
 * duplicate/personal-workspace refusals) lives in the grants service the
 * mount is handed, so what is under test here is that each of that service's
 * named refusals reaches the caller at the status and code it declares, and
 * that a successful write reads back through the same wire it lists with.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  ApiKeyNotInOrganizationError,
  AuthzPersonalWorkspaceNotManagedHereError,
  DuplicateGrantError,
  OrgExclusivePermissionScopeError,
  RoleBindingNotFoundError,
  RoleBindingPrincipalInvalidError,
  ScopeNotInOrganizationError,
  type AuthzGrantsService,
  type AuthzManagedOrganizationBinding,
  type AuthzService,
} from "@langwatch/authz-contract";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../app-rest.process-features";
import type { ApiPackagedRestCollaborators } from "../app-rest.packaged-families";

const ORG_ID = "organization-1";

function bindingRow(
  overrides: Partial<AuthzManagedOrganizationBinding> = {},
): AuthzManagedOrganizationBinding {
  return {
    id: "binding-1",
    userId: null,
    userName: null,
    userEmail: null,
    userImage: null,
    groupId: null,
    groupName: null,
    groupScimSource: null,
    apiKeyId: null,
    apiKeyName: null,
    role: "MEMBER",
    customRoleId: null,
    customRoleName: null,
    scopeType: "TEAM",
    scopeId: "team-1",
    scopeName: "Team",
    memberUserIds: [],
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("given the role-bindings family this process composes", () => {
  describe("when listing bindings", () => {
    /** @scenario "Listing role bindings supports principal and scope filters" */
    it("filters by principal and narrows further by scope", async () => {
      const rows = [
        bindingRow({ id: "b-user", userId: "user-1", scopeType: "TEAM", scopeId: "team-1" }),
        bindingRow({ id: "b-user-other-scope", userId: "user-1", scopeType: "PROJECT", scopeId: "project-1" }),
        bindingRow({ id: "b-group", groupId: "group-1", userId: null }),
        bindingRow({ id: "b-key", apiKeyId: "key-1", userId: null }),
      ];
      const listManagedBindingsForOrganization = vi.fn(async () => rows);
      const api = mount({
        permissions: () =>
          ({ listManagedBindingsForOrganization }) as unknown as AuthzService,
      });

      const byUser = await api.fetch("/api/role-bindings/latest/?userId=user-1");
      expect(byUser.status).toBe(200);
      const byUserBody = (await byUser.json()) as { bindings: { id: string }[]; totalCount: number };
      expect(byUserBody.bindings.map((b) => b.id)).toEqual(["b-user", "b-user-other-scope"]);

      const byUserAndScope = await api.fetch(
        "/api/role-bindings/latest/?userId=user-1&scopeType=TEAM&scopeId=team-1",
      );
      const byUserAndScopeBody = (await byUserAndScope.json()) as { bindings: { id: string }[] };
      expect(byUserAndScopeBody.bindings.map((b) => b.id)).toEqual(["b-user"]);
    });
  });

  describe("when creating a binding", () => {
    /** @scenario "Binding a role to a user at team scope succeeds" */
    it("names the user as the binding's principal", async () => {
      const created = { id: "binding-new" };
      const createBinding = vi.fn(async () => created);
      const listManagedBindingsForOrganization = vi.fn(async () => [
        bindingRow({
          id: "binding-new",
          userId: "user-1",
          userName: "Ada",
          scopeType: "TEAM",
          scopeId: "team-1",
        }),
      ]);
      const api = mount({
        permissions: () =>
          ({
            listManagedBindingsForOrganization,
            wouldFirstBindingDisableLegacyAccess: async () => false,
          }) as unknown as AuthzService,
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "team-1",
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { principal: { type: string; id: string } };
      expect(body.principal).toEqual({ type: "user", id: "user-1", name: "Ada" });
    });

    /** @scenario "Binding a custom role to a group succeeds" */
    it("returns the custom role the binding was created with", async () => {
      const createBinding = vi.fn(async () => ({ id: "binding-new" }));
      const listManagedBindingsForOrganization = vi.fn(async () => [
        bindingRow({
          id: "binding-new",
          groupId: "group-1",
          groupName: "Reviewers",
          role: "CUSTOM",
          customRoleId: "role-1",
          customRoleName: "Auditor",
          scopeType: "PROJECT",
          scopeId: "project-1",
        }),
      ]);
      const api = mount({
        permissions: () =>
          ({
            listManagedBindingsForOrganization,
            wouldFirstBindingDisableLegacyAccess: async () => false,
          }) as unknown as AuthzService,
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: "group-1",
          role: "CUSTOM",
          customRoleId: "role-1",
          scopeType: "PROJECT",
          scopeId: "project-1",
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { customRoleId: string; customRoleName: string };
      expect(body.customRoleId).toBe("role-1");
      expect(body.customRoleName).toBe("Auditor");
    });

    /** @scenario "Binding a role to an API key succeeds" */
    it("binds the key as a viewer, granting read and not write", async () => {
      const createBinding = vi.fn(async () => ({ id: "binding-new" }));
      const listManagedBindingsForOrganization = vi.fn(async () => [
        bindingRow({
          id: "binding-new",
          apiKeyId: "key-1",
          apiKeyName: "deploy bot",
          role: "VIEWER",
          scopeType: "PROJECT",
          scopeId: "project-1",
        }),
      ]);
      const api = mount({
        permissions: () =>
          ({
            listManagedBindingsForOrganization,
            wouldFirstBindingDisableLegacyAccess: async () => false,
          }) as unknown as AuthzService,
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "key-1",
          role: "VIEWER",
          scopeType: "PROJECT",
          scopeId: "project-1",
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        principal: { type: string; id: string };
        role: string;
      };
      expect(body.principal).toEqual({ type: "apiKey", id: "key-1", name: "deploy bot" });
      expect(body.role).toBe("VIEWER");
    });

    /** @scenario "A binding naming no principal, or more than one, is refused" */
    it("refuses a binding naming zero or two principals before writing anything", async () => {
      const createBinding = vi.fn(async () => {
        throw new RoleBindingPrincipalInvalidError();
      });
      const api = mount({
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const none = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }),
      });
      expect(none.status).toBe(422);
      await expect(none.json()).resolves.toMatchObject({ code: "role_binding_principal_invalid" });

      const both = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          groupId: "group-1",
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "team-1",
        }),
      });
      expect(both.status).toBe(422);
      await expect(both.json()).resolves.toMatchObject({ code: "role_binding_principal_invalid" });
    });

    /** @scenario "Binding an API key from another organization is refused" */
    it("refuses a key that does not belong to the caller's organization", async () => {
      const createBinding = vi.fn(async () => {
        throw new ApiKeyNotInOrganizationError("foreign-key");
      });
      const api = mount({
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "foreign-key",
          role: "VIEWER",
          scopeType: "PROJECT",
          scopeId: "project-1",
        }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: "api_key_not_in_organization" });
    });

    /** @scenario "Binding to a scope from another organization is refused" */
    it("refuses a scope from another organization", async () => {
      const createBinding = vi.fn(async () => {
        throw new ScopeNotInOrganizationError("TEAM");
      });
      const api = mount({
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "foreign-team",
        }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: "scope_not_in_organization" });
    });

    /** @scenario "Binding an organization-exclusive permission at team scope is refused" */
    it("refuses an organization-exclusive custom role below organization scope", async () => {
      const createBinding = vi.fn(async () => {
        throw new OrgExclusivePermissionScopeError("organization:billing", "TEAM");
      });
      const api = mount({
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          role: "CUSTOM",
          customRoleId: "role-1",
          scopeType: "TEAM",
          scopeId: "team-1",
        }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: "org_exclusive_permission_scope" });
    });

    /** @scenario "A duplicate binding is reported as already existing" */
    it("reports a repeated declaration as already existing", async () => {
      const createBinding = vi.fn(async () => {
        throw new DuplicateGrantError();
      });
      const api = mount({
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "team-1",
        }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "role_binding_already_exists" });
    });

    /** @scenario "A binding into a personal workspace is refused" */
    it("refuses a binding into another member's personal workspace", async () => {
      const createBinding = vi.fn(async () => {
        throw new AuthzPersonalWorkspaceNotManagedHereError();
      });
      const api = mount({
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-2",
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "personal-team-1",
        }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "personal_workspace_not_managed_here",
      });
    });

    /** @scenario "The first explicit binding for a legacy user is reported in the response" */
    it("notes that team-derived access no longer applies, and still creates the binding", async () => {
      const createBinding = vi.fn(async () => ({ id: "binding-new" }));
      const wouldFirstBindingDisableLegacyAccess = vi.fn(async () => true);
      const listManagedBindingsForOrganization = vi.fn(async () => [
        bindingRow({ id: "binding-new", userId: "user-1" }),
      ]);
      const api = mount({
        permissions: () =>
          ({
            listManagedBindingsForOrganization,
            wouldFirstBindingDisableLegacyAccess,
          }) as unknown as AuthzService,
        authzGrants: () => ({ createBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "team-1",
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { hasLegacyAccessNotice?: boolean };
      expect(body.hasLegacyAccessNotice).toBe(true);
      expect(createBinding).toHaveBeenCalled();
    });
  });

  describe("when deleting a binding", () => {
    /** @scenario "Deleting a binding removes it" */
    it("removes the binding", async () => {
      const deleteBinding = vi.fn(async () => ({ success: true as const }));
      const api = mount({
        authzGrants: () => ({ deleteBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/binding-1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(deleteBinding).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, bindingId: "binding-1" }),
      );
    });

    /** @scenario "Deleting an unknown binding returns not found" */
    it("answers 404 for a binding id that does not exist", async () => {
      const deleteBinding = vi.fn(async () => {
        throw new RoleBindingNotFoundError("missing-binding");
      });
      const api = mount({
        authzGrants: () => ({ deleteBinding }) as unknown as AuthzGrantsService,
      });

      const response = await api.fetch("/api/role-bindings/latest/missing-binding", { method: "DELETE" });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "role_binding_not_found" });
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mount(services: ApiPackagedRestCollaborators["services"]) {
  const hono = new Hono();
  const defaultAuthzService = {
    listManagedBindingsForOrganization: async () => [],
    wouldFirstBindingDisableLegacyAccess: async () => false,
  } as unknown as AuthzService;
  const defaultAuthzGrants = {
    createBinding: async () => ({ id: "binding-new" }),
    updateBinding: async () => ({ id: "binding-1" }),
    deleteBinding: async () => ({ success: true as const }),
  } as unknown as AuthzGrantsService;
  const merged: ApiPackagedRestCollaborators["services"] = {
    ...services,
    permissions: services.permissions ?? (() => defaultAuthzService),
    authzGrants: services.authzGrants ?? (() => defaultAuthzGrants),
  };
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: { packaged: { services: merged, ports: fullPorts() } },
    ports: {
      handlerManagedCredential: () => {
        throw new Error("This family authenticates through the framework chain.");
      },
      rateLimit: async () => ({ allowed: true }),
    },
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function fullPorts(): ApiPackagedRestCollaborators["ports"] {
  const noopMiddleware: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return {
    agentPlatformUrl: () => "https://app.langwatch.test/acme/agents",
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    scenarioRunPlatformUrl: () => "https://app.langwatch.test/acme/simulations",
    canonicalError: () => ({ status: 500, body: {} as never }),
    organizationMiddleware: noopMiddleware,
    managementAudit: () => {},
    organizationLedgerActor: () => ({ type: "user", id: "user-1" }) as never,
    rbacVocabulary: {
      actions: ["view"],
      resources: ["traces"],
      isOrganizationExclusive: () => false,
    },
    instanceAdminKey: () => "instance-key",
    isSaas: () => false,
    reportError: () => {},
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    monitorMappingsSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
    requireApiKeyPermission: () => noopMiddleware,
    traceUsageGuard: noopMiddleware,
    requireProjectPermission: async () => {},
    dualAuth: noopMiddleware,
    enterpriseGate: () => noopMiddleware,
    authorizeDatasetDirectUpload: async () => ({ ok: false, status: 401, error: "no" }),
    extractInlineMedia: async ({ event }) => ({ rewrittenEvent: event, refs: [] }),
    triggerWorkflowEvaluation: () => Promise.reject(new Error("no runner")),
  } as ApiPackagedRestCollaborators["ports"];
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: ORG_ID });
    c.set("apiKeyUserId", "user-1");
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
