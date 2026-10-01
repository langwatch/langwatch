/**
 * @vitest-environment node
 * `/api/role-bindings` on the real declaration over a real AuthZ application:
 * the grants ledger is a stand-in that keeps the rows a ledger would project.
 * @see specs/rbac/role-bindings-rest-api.feature
 */
import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
import {
  RoleBindingNotFoundError,
  type AuthzManagedOrganizationBinding,
} from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAuthzTestApp } from "../../app/__tests__/authz.fixture.ts";
import { authzRoleBindingRest, roleBindingRestFacts } from "../authz-role-binding.rest.ts";

const ORGANIZATION_ID = "org-1";
const CREDENTIAL = "organization-credential";

const row = (
  over: Partial<AuthzManagedOrganizationBinding> & Pick<AuthzManagedOrganizationBinding, "id">,
): AuthzManagedOrganizationBinding => ({
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
  scopeId: "team-a",
  scopeName: "Team A",
  memberUserIds: [],
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  expiresAt: null,
  ...over,
});

function world({ rows = [] as AuthzManagedOrganizationBinding[] } = {}) {
  let next = 0;
  const app = createAuthzTestApp({
    permissions: { listManagedBindingsForOrganization: async () => [...rows] },
    grants: {
      createBinding: async (input) => {
        const id = `rb_new_${++next}`;
        rows.push(
          row({
            id,
            userId: input.userId ?? null,
            groupId: input.groupId ?? null,
            apiKeyId: input.apiKeyId ?? null,
            role: input.role,
            customRoleId: input.customRoleId ?? null,
            customRoleName: input.customRoleId ? "Release Manager" : null,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
          }),
        );
        return { id };
      },
      deleteBinding: async (input) => {
        const at = rows.findIndex((candidate) => candidate.id === input.bindingId);
        if (at < 0) throw new RoleBindingNotFoundError(input.bindingId);
        rows.splice(at, 1);
        return { success: true };
      },
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
    entitlements: { holds: async () => true },
  });
  const hono = runtime.mount(authzRoleBindingRest.router(), {
    app: () => app,
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:role-bindings:errors",
      label: "Role Bindings API Error",
    }),
    facts: [
      bindRestMiddleware(roleBindingRestFacts, () => ({
        organizationId: ORGANIZATION_ID,
        actor: { type: "user" as const, id: "user-owner" },
        caller: { type: "apiKey" as const, id: "key-1" },
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

  return { send, rows };
}

describe("given the /api/role-bindings family", () => {
  describe("when bindings are listed with filters", () => {
    /** @scenario Listing role bindings supports principal and scope filters */
    it("narrows by principal and then by scope, naming each principal", async () => {
      const { send } = world({
        rows: [
          row({ id: "rb_1", userId: "user-1", userName: "Ana", scopeId: "team-a" }),
          row({ id: "rb_2", userId: "user-1", userName: "Ana", scopeId: "team-b" }),
          row({ id: "rb_3", groupId: "group-1", groupName: "Engineering", scopeId: "team-a" }),
          row({ id: "rb_4", apiKeyId: "key-1", apiKeyName: "CI", scopeId: "team-b" }),
        ],
      });

      const byUser = await send("/api/role-bindings?userId=user-1");
      const byUserAndScope = await send("/api/role-bindings?userId=user-1&scopeId=team-b");

      expect(byUser.status).toBe(200);
      expect(await byUser.json()).toMatchObject({
        totalCount: 2,
        bindings: [
          { id: "rb_1", principal: { type: "user", id: "user-1", name: "Ana" } },
          { id: "rb_2", principal: { type: "user", id: "user-1", name: "Ana" } },
        ],
      });
      expect(await byUserAndScope.json()).toMatchObject({
        totalCount: 1,
        bindings: [{ id: "rb_2" }],
      });
    });
  });

  describe("when a binding is created", () => {
    /** @scenario Binding a role to a user at team scope succeeds */
    it("answers 201 naming the user, and the team then lists the binding", async () => {
      const { send } = world();

      const response = await send("/api/role-bindings", {
        method: "POST",
        body: { userId: "user-1", role: "MEMBER", scopeType: "TEAM", scopeId: "team-a" },
      });
      const listed = await send("/api/role-bindings?scopeType=TEAM&scopeId=team-a");

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        principal: { type: "user", id: "user-1" },
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: "team-a",
      });
      expect(await listed.json()).toMatchObject({ totalCount: 1 });
    });

    /** @scenario Binding a custom role to a group succeeds */
    it("answers 201 and reading the binding back returns the custom role", async () => {
      const { send } = world();

      const response = await send("/api/role-bindings", {
        method: "POST",
        body: {
          groupId: "group-1",
          role: "CUSTOM",
          customRoleId: "role-1",
          scopeType: "PROJECT",
          scopeId: "project-1",
        },
      });
      const listed = await send("/api/role-bindings?groupId=group-1");

      expect(response.status).toBe(201);
      expect(await listed.json()).toMatchObject({
        bindings: [
          {
            principal: { type: "group", id: "group-1" },
            customRoleId: "role-1",
            customRoleName: "Release Manager",
          },
        ],
      });
    });

    /** @scenario The first explicit binding for a legacy user is created normally */
    it("answers 201 with the ordinary binding shape", async () => {
      const { send } = world();

      const response = await send("/api/role-bindings", {
        method: "POST",
        body: { userId: "legacy-user", role: "ADMIN", scopeType: "TEAM", scopeId: "team-a" },
      });

      expect(response.status).toBe(201);
      expect(
        Object.keys(z.record(z.string(), z.unknown()).parse(await response.json())).toSorted(),
      ).toEqual([
        "createdAt",
        "customRoleId",
        "customRoleName",
        "expiresAt",
        "id",
        "principal",
        "role",
        "scopeId",
        "scopeName",
        "scopeType",
      ]);
    });
  });

  describe("when a binding is deleted", () => {
    /** @scenario Deleting a binding removes it */
    it("answers 200 and the team no longer lists it", async () => {
      const { send } = world({ rows: [row({ id: "rb_1", userId: "user-1" })] });

      const response = await send("/api/role-bindings/rb_1", { method: "DELETE" });
      const listed = await send("/api/role-bindings?scopeId=team-a");

      expect(response.status).toBe(200);
      expect(await listed.json()).toMatchObject({ totalCount: 0, bindings: [] });
    });

    /** @scenario Deleting an unknown binding returns not found */
    it("answers a binding id nobody holds as not found", async () => {
      const { send } = world();

      const response = await send("/api/role-bindings/rb_nope", { method: "DELETE" });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "role_binding_not_found" });
    });
  });
});
