/**
 * The custom-roles REST family (`/api/roles`), driven through the real Hono app
 * `createApiProcessRestFeatures` returns.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  RoleDuplicateNameError,
  RoleInUseError,
  RoleNotFoundError,
} from "@langwatch/role-contract";
import type { Role, RoleService } from "@langwatch/role-contract";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../app-rest.process-features";
import type { ApiPackagedRestCollaborators } from "../app-rest.packaged-families";

const ORG_ID = "organization-1";

function role(overrides: Partial<Role & { permissions: string[] }> = {}) {
  return {
    id: "role-1",
    organizationId: ORG_ID,
    name: "Release Manager",
    description: null,
    permissions: ["project:view"],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Role & { permissions: string[] };
}

describe("given the roles family this process composes", () => {
  describe("when listing roles", () => {
    /** @scenario "Listing custom roles returns the organization's roles" */
    it("returns only the caller's organization's roles, with their permissions", async () => {
      const list = vi.fn(async () => [
        role({ id: "role-1", name: "Release Manager" }),
        role({ id: "role-2", name: "Auditor", permissions: ["governance:view"] }),
      ]);
      const api = mount({ roles: () => ({ list }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { roles: { id: string; permissions: string[] }[] };
      expect(body.roles.map((r) => r.id)).toEqual(["role-1", "role-2"]);
      expect(body.roles[1]!.permissions).toEqual(["governance:view"]);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID }));
    });
  });

  describe("when creating a role", () => {
    /** @scenario "Creating a role from permission keys succeeds" */
    it("returns the role id, name, description and both permissions", async () => {
      const create = vi.fn(async () =>
        role({
          id: "role-new",
          name: "Release Manager",
          description: null,
          permissions: ["project:view", "prompts:manage"],
        }),
      );
      const api = mount({ roles: () => ({ create }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Release Manager",
          permissions: ["project:view", "prompts:manage"],
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        id: string;
        name: string;
        permissions: string[];
      };
      expect(body).toMatchObject({
        id: "role-new",
        name: "Release Manager",
        permissions: ["project:view", "prompts:manage"],
      });
    });

    /** @scenario "Creating a role with an unknown permission key is refused" */
    it("refuses an unknown permission key before reaching the service", async () => {
      const create = vi.fn();
      const api = mount({ roles: () => ({ create }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Teleporter", permissions: ["project:teleport"] }),
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("validation_error");
      expect(create).not.toHaveBeenCalled();
    });

    /** @scenario "Creating a role with a taken name is refused" */
    it("reports a taken name as a conflict", async () => {
      const create = vi.fn(async () => {
        throw new RoleDuplicateNameError();
      });
      const api = mount({ roles: () => ({ create }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Release Manager", permissions: ["project:view"] }),
      });

      expect(response.status).toBe(409);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("custom_role_name_taken");
    });
  });

  describe("when fetching a role", () => {
    /** @scenario "Fetching a role by id returns it" */
    it("returns every field creating the role accepted", async () => {
      const created = role({
        id: "role-1",
        name: "Release Manager",
        description: "Ships releases",
        permissions: ["project:view"],
      });
      const getForOrganization = vi.fn(async () => created);
      const api = mount({ roles: () => ({ getForOrganization }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/role-1");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; description: string | null };
      expect(body).toMatchObject({
        id: "role-1",
        name: "Release Manager",
        description: "Ships releases",
        permissions: ["project:view"],
      });
      expect(getForOrganization).toHaveBeenCalledWith({ roleId: "role-1", organizationId: ORG_ID });
    });

    /** @scenario "Fetching a role from another organization is refused" */
    it("answers 404 for a role from another organization", async () => {
      const getForOrganization = vi.fn(async () => {
        throw new RoleNotFoundError("foreign-role");
      });
      const api = mount({ roles: () => ({ getForOrganization }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/foreign-role");

      expect(response.status).toBe(404);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("custom_role_not_found");
    });
  });

  describe("when updating a role", () => {
    /** @scenario "Replacing a role's permission set takes effect" */
    it("replaces the permission set", async () => {
      const updateForOrganization = vi.fn(async () =>
        role({ id: "role-1", permissions: ["project:view"] }),
      );
      const api = mount({ roles: () => ({ updateForOrganization }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/role-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissions: ["project:view"] }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { permissions: string[] };
      expect(body.permissions).toEqual(["project:view"]);
      expect(updateForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          roleId: "role-1",
          organizationId: ORG_ID,
          changes: { permissions: ["project:view"] },
        }),
      );
    });
  });

  describe("when deleting a role", () => {
    /** @scenario "Deleting an unbound role succeeds" */
    it("deletes a role nothing is bound to", async () => {
      const removeForOrganization = vi.fn(async () => ({ success: true as const }));
      const api = mount({ roles: () => ({ removeForOrganization }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/role-1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
    });

    /** @scenario "Deleting a role that is still bound is refused" */
    it("refuses to delete a role still bound, and reports how many bindings use it", async () => {
      const removeForOrganization = vi.fn(async () => {
        throw new RoleInUseError({ userCount: 1, bindingCount: 0 });
      });
      const api = mount({ roles: () => ({ removeForOrganization }) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/role-1", { method: "DELETE" });

      expect(response.status).toBe(409);
      const body = (await response.json()) as { code: string; meta: Record<string, unknown> };
      expect(body.code).toBe("custom_role_in_use");
      expect(body.meta).toMatchObject({ userCount: 1 });
    });
  });

  describe("when reading the permission catalog", () => {
    /** @scenario "The permission catalog lists organization-exclusive permissions" */
    it("groups every permission by resource and marks organization-exclusive ones", async () => {
      const api = mount({ roles: () => ({}) as unknown as RoleService });

      const response = await api.fetch("/api/roles/latest/permissions");

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        resources: { resource: string; organizationExclusive: boolean; permissions: string[] }[];
      };
      expect(body.resources).toEqual([
        {
          resource: "project",
          organizationExclusive: true,
          actions: ["view", "manage"],
          permissions: ["project:view", "project:manage"],
        },
        {
          resource: "prompts",
          organizationExclusive: false,
          actions: ["view", "manage"],
          permissions: ["prompts:view", "prompts:manage"],
        },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mount(services: ApiPackagedRestCollaborators["services"]) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: { packaged: { services, ports: fullPorts() } },
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
      actions: ["view", "manage"],
      resources: ["project", "prompts"],
      isOrganizationExclusive: (resource: string) => resource === "project",
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
  const renderHandled = (
    error: unknown,
    c: Parameters<AppRestSecurity["legacyErrorHandler"]>[1],
  ) => {
    const handled = error as { httpStatus?: number; code?: string; message?: string };
    if (typeof handled.httpStatus === "number") {
      return c.json(
        { error: handled.code ?? "error", message: handled.message ?? "" },
        handled.httpStatus as never,
      );
    }
    return c.json({ error: String(error) }, 500);
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
