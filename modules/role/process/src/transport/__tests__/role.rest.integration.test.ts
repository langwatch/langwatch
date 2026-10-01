/**
 * @vitest-environment node
 * `/api/roles` on the real declaration over a real role application: the
 * grants ledger is a small stand-in that writes the rows a ledger would.
 * @see specs/rbac/roles-rest-api.feature
 */
import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { AuthzAccessBinding } from "@langwatch/authz-contract";
import { ROLE_KIND, type Role } from "@langwatch/role-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createRoleTestApp, testBinding } from "../../app/__tests__/role.fixture.ts";
import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { roleRest, roleRestFacts } from "../role.rest.ts";

const ORGANIZATION_ID = "org-1";
const OTHER_ORGANIZATION_ID = "org-2";
const CREDENTIAL = "organization-credential";

/** A custom role as the ledger stores it: always with its definition moment. */
type StoredRole = Role & { createdAt: Date; updatedAt: Date };

const stored = (over: Partial<StoredRole> & Pick<Role, "id" | "name">): StoredRole => ({
  organizationId: ORGANIZATION_ID,
  description: null,
  permissions: ["project:view"],
  kind: ROLE_KIND.CUSTOM,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const catalogSchema = z.object({
  resources: z.array(
    z.object({
      resource: z.string(),
      permissions: z.array(z.string()),
      organizationExclusive: z.boolean(),
    }),
  ),
});

function world({
  bindings = [] as AuthzAccessBinding[],
  callerLacks = [] as string[],
  enterprise = true,
} = {}) {
  const roles = MemoryRoleRepository.create();
  const ledger = new Map<string, StoredRole>();
  const state = (role: StoredRole) => {
    roles.save(role);
    ledger.set(role.id, role);
  };
  const { app } = createRoleTestApp({
    roles,
    permissions: {
      defineRole: async (input) => {
        state(
          stored({
            id: input.roleId,
            organizationId: input.organizationId,
            name: input.name,
            description: input.description ?? null,
            permissions: input.permissions,
          }),
        );
      },
      deleteRole: async (input) => {
        ledger.delete(input.roleId);
        roles.forget({ roleId: input.roleId });
      },
      listUserCreatedRoles: async ({ organizationId }) =>
        [...ledger.values()].filter((role) => role.organizationId === organizationId),
      listOrganizationBindings: async () => bindings,
      findPermissionsBeyondCaller: async (input) =>
        input.permissions.filter((permission) => callerLacks.includes(permission)),
    },
  });

  const admit = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }
    return {
      actor: { type: "user" as const, id: "user-owner" },
      scope: { tier: "organization" as const, id: ORGANIZATION_ID },
    };
  };
  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => admit(request),
      authenticate: ({ request }) => admit(request),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
    entitlements: { holds: async () => enterprise },
  });
  const hono = runtime.mount(roleRest.router(), {
    app: () => app,
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:roles:errors",
      label: "Roles API Error",
    }),
    facts: [
      bindRestMiddleware(roleRestFacts, () => ({
        organizationId: ORGANIZATION_ID,
        apiKeyId: "key-1",
      })),
    ],
  });

  const send = (path: string, init: { method?: string; body?: unknown } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { send, ledger, state };
}

const roleIdsOf = (body: unknown) =>
  z
    .object({ roles: z.array(z.object({ id: z.string() })) })
    .parse(body)
    .roles.map((role) => role.id);

describe("given the /api/roles family", () => {
  describe("when the organization is below Enterprise", () => {
    /** @scenario The roles family answers 402 below Enterprise, naming RBAC */
    it("refuses reading and defining roles with enterprise_plan_required naming RBAC", async () => {
      const { send, ledger } = world({ enterprise: false });

      const answers = await Promise.all([
        send("/api/roles"),
        send("/api/roles", {
          method: "POST",
          body: { name: "Ops", permissions: ["project:view"] },
        }),
      ]);

      for (const answer of answers) {
        expect(await answer.json()).toMatchObject({
          code: "enterprise_plan_required",
          meta: { feature: "RBAC" },
        });
      }
      expect(ledger.size).toBe(0);
    });
  });

  describe("when the organization's roles are listed", () => {
    /** @scenario Listing custom roles returns the organization's roles */
    it("answers its own roles with their permissions and none from another organization", async () => {
      const { send, state } = world();
      state(stored({ id: "role-a", name: "Release Manager", permissions: ["project:view"] }));
      state(stored({ id: "role-b", name: "Auditor", permissions: ["traces:view"] }));
      state(stored({ id: "role-c", name: "Elsewhere", organizationId: OTHER_ORGANIZATION_ID }));

      const response = await send("/api/roles");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        roles: [
          { id: "admin", builtIn: true },
          { id: "member", builtIn: true },
          { id: "viewer", builtIn: true },
          { id: "role-a", name: "Release Manager", permissions: ["project:view"], builtIn: false },
          { id: "role-b", name: "Auditor", permissions: ["traces:view"], builtIn: false },
        ],
      });
    });
  });

  describe("when a role is created", () => {
    /** @scenario Creating a role from permission keys succeeds */
    it("answers 201 with the id, name, description and both permissions", async () => {
      const { send } = world();

      const response = await send("/api/roles", {
        method: "POST",
        body: {
          name: "Release Manager",
          description: "Ships releases",
          permissions: ["project:view", "prompts:manage"],
        },
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        id: expect.any(String),
        name: "Release Manager",
        description: "Ships releases",
        permissions: ["project:view", "prompts:manage"],
      });
    });

    /** @scenario Creating a role with an unknown permission key is refused */
    it("refuses an unknown permission key as a validation error and writes nothing", async () => {
      const { send, ledger } = world();

      const response = await send("/api/roles", {
        method: "POST",
        body: { name: "Teleporter", permissions: ["project:teleport"] },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(ledger.size).toBe(0);
    });

    /** @scenario Creating a role with a taken name is refused */
    it("refuses a taken name with a conflict and keeps the one role", async () => {
      const { send, state, ledger } = world();
      state(stored({ id: "role-a", name: "Release Manager" }));

      const response = await send("/api/roles", {
        method: "POST",
        body: { name: "Release Manager", permissions: ["project:view"] },
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "custom_role_name_taken" });
      expect([...ledger.values()].filter((role) => role.name === "Release Manager")).toHaveLength(
        1,
      );
    });
  });

  describe("when one role is fetched", () => {
    /** @scenario Fetching a role by id returns it */
    it("returns every field creating it accepted", async () => {
      const { send } = world();
      const { id } = z.object({ id: z.string() }).parse(
        await (
          await send("/api/roles", {
            method: "POST",
            body: { name: "Auditor", description: "Reads", permissions: ["traces:view"] },
          })
        ).json(),
      );

      const response = await send(`/api/roles/${id}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id,
        name: "Auditor",
        description: "Reads",
        permissions: ["traces:view"],
      });
    });

    /** @scenario Fetching a role from another organization is refused */
    it("answers a role of another organization as not found", async () => {
      const { send, state } = world();
      state(stored({ id: "role-x", name: "Elsewhere", organizationId: OTHER_ORGANIZATION_ID }));

      const response = await send("/api/roles/role-x");

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "custom_role_not_found" });
    });
  });

  describe("when a role's permissions are replaced", () => {
    /** @scenario Replacing a role's permission set takes effect */
    it("returns only the permission left after fetching it again", async () => {
      const { send, state } = world();
      state(
        stored({
          id: "role-a",
          name: "Release Manager",
          permissions: ["project:view", "prompts:manage"],
        }),
      );

      const updated = await send("/api/roles/role-a", {
        method: "PATCH",
        body: { permissions: ["project:view"] },
      });
      const fetched = await send("/api/roles/role-a");

      expect(updated.status).toBe(200);
      expect(await fetched.json()).toMatchObject({ permissions: ["project:view"] });
    });
  });

  describe("when a role is deleted", () => {
    /** @scenario Deleting an unbound role succeeds */
    it("answers 200 and then finds nothing at the id", async () => {
      const { send, state } = world();
      state(stored({ id: "role-a", name: "Release Manager" }));

      const deleted = await send("/api/roles/role-a", { method: "DELETE" });
      const fetched = await send("/api/roles/role-a");

      expect(deleted.status).toBe(200);
      expect(fetched.status).toBe(404);
      expect(await fetched.json()).toMatchObject({ code: "custom_role_not_found" });
    });

    /** @scenario Deleting a role that is still bound is refused */
    it("refuses a bound role with the binding count and keeps it", async () => {
      const { send, state } = world({
        bindings: [testBinding({ customRoleId: "role-a" })],
      });
      state(stored({ id: "role-a", name: "Release Manager" }));

      const response = await send("/api/roles/role-a", { method: "DELETE" });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "custom_role_in_use",
        meta: { bindingCount: 1 },
      });
      expect((await send("/api/roles/role-a")).status).toBe(200);
    });
  });

  describe("when the permission catalog is listed", () => {
    /** @scenario The permission catalog lists organization-exclusive permissions */
    it("groups permissions by resource and marks the organization-only ones", async () => {
      const { send } = world();

      const response = await send("/api/roles/permissions");
      const catalog = catalogSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(catalog.resources.length).toBeGreaterThan(0);
      for (const entry of catalog.resources) {
        expect(entry.permissions.every((key) => key.startsWith(`${entry.resource}:`))).toBe(true);
      }
      expect(catalog.resources.map((entry) => entry.organizationExclusive)).toEqual(
        expect.arrayContaining([true, false]),
      );
    });
  });

  describe("when the built-in roles are addressed", () => {
    /** @scenario The role list includes the built-in roles unless filtered */
    it("lists admin, member and viewer first, marked built in, even with no custom roles", async () => {
      const { send } = world();

      const response = await send("/api/roles");

      expect(response.status).toBe(200);
      const body = z
        .object({ roles: z.array(z.object({ id: z.string(), builtIn: z.boolean() })) })
        .parse(await response.json());
      expect(body.roles).toEqual([
        { ...body.roles[0], id: "admin", builtIn: true },
        { ...body.roles[1], id: "member", builtIn: true },
        { ...body.roles[2], id: "viewer", builtIn: true },
      ]);
    });

    /** @scenario The role list filters to the built-in roles */
    it("lists only admin, member and viewer when builtIn is true", async () => {
      const { send, state } = world();
      state(stored({ id: "role-a", name: "Auditor" }));

      const response = await send("/api/roles?builtIn=true");

      expect(response.status).toBe(200);
      expect(roleIdsOf(await response.json())).toEqual(["admin", "member", "viewer"]);
    });

    /** @scenario The role list filters to the custom roles */
    it("lists only the custom roles when builtIn is false", async () => {
      const { send, state } = world();
      state(stored({ id: "role-a", name: "Auditor" }));

      const response = await send("/api/roles?builtIn=false");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        roles: [expect.objectContaining({ id: "role-a", name: "Auditor", builtIn: false })],
      });
    });

    /** @scenario A builtIn filter that is not true or false is refused */
    it("refuses builtIn=yes as a validation error", async () => {
      const { send } = world();

      const response = await send("/api/roles?builtIn=yes");

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
    });

    /** @scenario Built-in roles are addressable by stable ids */
    it("answers the admin role by its stable id with its permissions", async () => {
      const { send } = world();

      const response = await send("/api/roles/admin");

      expect(response.status).toBe(200);
      const body = z
        .object({ id: z.string(), builtIn: z.boolean(), permissions: z.array(z.string()) })
        .parse(await response.json());
      expect(body.id).toBe("admin");
      expect(body.builtIn).toBe(true);
      expect(body.permissions).toContain("project:view");
    });

    /** @scenario A built-in role cannot be changed or deleted */
    it("refuses a change or a delete of a built-in role with role_is_built_in", async () => {
      const { send } = world();

      const patched = await send("/api/roles/viewer", {
        method: "PATCH",
        body: { name: "Reader" },
      });
      const deleted = await send("/api/roles/viewer", { method: "DELETE" });

      for (const response of [patched, deleted]) {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "role_is_built_in" });
      }
    });
  });

  describe("when a role would carry a permission the caller lacks", () => {
    /** @scenario A custom role cannot be given a permission the caller lacks */
    it("refuses the create and the widening with role_exceeds_caller_permissions", async () => {
      const { send, state, ledger } = world({ callerLacks: ["secrets:manage"] });
      state(stored({ id: "role-a", name: "Release Manager", permissions: ["project:view"] }));

      const created = await send("/api/roles", {
        method: "POST",
        body: { name: "Vault", permissions: ["secrets:manage"] },
      });
      const widened = await send("/api/roles/role-a", {
        method: "PATCH",
        body: { permissions: ["project:view", "secrets:manage"] },
      });

      for (const response of [created, widened]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: "role_exceeds_caller_permissions",
          meta: { missingPermissions: ["secrets:manage"] },
        });
      }
      expect(ledger.get("role-a")?.permissions).toEqual(["project:view"]);
      expect([...ledger.values()].some((role) => role.name === "Vault")).toBe(false);
    });

    /** @scenario A custom role may keep permissions the caller lacks when they are not added */
    it("renames a role that already carries a permission the caller lacks", async () => {
      const { send, state } = world({ callerLacks: ["secrets:manage"] });
      state(stored({ id: "role-v", name: "Vault", permissions: ["secrets:manage"] }));

      const response = await send("/api/roles/role-v", {
        method: "PATCH",
        body: { name: "Vault keepers" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ name: "Vault keepers" });
    });
  });
});
