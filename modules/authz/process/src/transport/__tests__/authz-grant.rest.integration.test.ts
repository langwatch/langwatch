/**
 * @vitest-environment node
 * `/api/grants` and the deprecated `/api/role-bindings` on their real declarations, over
 * the real grant management and binding writer: the stores are stand-ins holding rows.
 * @see specs/rbac/grants-rest-api.feature
 */
import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  IdempotencyConflictError,
  restRouteDocumentation,
  type IdempotentRunner,
  type RestDeprecationLog,
} from "@langwatch/api/rest";
import type { AuthzManagedOrganizationBinding, AuthzPrincipalRef } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAuthzTestApp } from "../../app/__tests__/authz.fixture.ts";
import type { AuthzCompatibilityLedger } from "../../app/authz.app.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { AuthzGrantManagementService } from "../../services/authz-grant-management.service.ts";
import { AuthzGrantWriterService } from "../../services/authz-grant-writer.service.ts";
import { authzGrantRest, grantRestFacts } from "../authz-grant.rest.ts";
import { authzRoleBindingRest, roleBindingRestFacts } from "../authz-role-binding.rest.ts";

const ORG = "org-1";
const KEY: AuthzPrincipalRef = { type: "apiKey", id: "key-caller" };
const SCOPES = [
  { type: "ORGANIZATION" as const, id: ORG, name: "Acme", personalWorkspaceName: null },
  { type: "TEAM" as const, id: "team-a", name: "Team A", personalWorkspaceName: null },
  { type: "TEAM" as const, id: "team-b", name: "Team B", personalWorkspaceName: null },
  { type: "PROJECT" as const, id: "proj-1", name: "Project", personalWorkspaceName: null },
  { type: "TEAM" as const, id: "team-ana", name: "Ana's", personalWorkspaceName: "Ana" },
];
const USERS = new Set(["user-1", "user-2"]);

const grantJson = z.object({
  id: z.string(),
  principal: z.object({ type: z.string(), id: z.string(), name: z.string().nullable() }),
  role: z.object({ id: z.string(), name: z.string().nullable(), builtIn: z.boolean() }),
  scope: z.object({ type: z.string(), id: z.string(), name: z.string().nullable() }),
  status: z.string(),
  expiresAt: z.string().nullable(),
});
const pageJson = z.object({ grants: z.array(grantJson), nextCursor: z.string().nullable() });
const errorJson = z.object({ code: z.string() }).passthrough();

function memoryIdempotency(): IdempotentRunner {
  const receipts = new Map<string, { body: string; status: number; serialized: string }>();

  return async ({ operation, scopeId, key, validatedBody, handler }) => {
    if (key === null) return { isReplayed: false, ...(await run(handler)) };
    const id = `${operation} ${scopeId} ${key}`;
    const body = JSON.stringify(validatedBody);
    const receipt = receipts.get(id);
    if (receipt && receipt.body !== body) throw new IdempotencyConflictError("body_mismatch");
    if (receipt)
      return { isReplayed: true, status: receipt.status, serializedBody: receipt.serialized };
    const outcome = await run(handler);
    receipts.set(id, {
      body,
      status: outcome.status,
      serialized: await outcome.response.clone().text(),
    });

    return { isReplayed: false, ...outcome };
  };
}

async function run(handler: () => Promise<Response>) {
  const response = await handler();

  return { status: response.status, response };
}

function world({
  rows = [] as AuthzManagedOrganizationBinding[],
  lacks = [] as string[],
  deprecationLog,
  enterprise = true,
}: {
  rows?: AuthzManagedOrganizationBinding[];
  lacks?: string[];
  deprecationLog?: RestDeprecationLog;
  /** Whether the organization's plan is Enterprise, as the process's plan port answers. */
  enterprise?: boolean;
} = {}) {
  let next = 0;
  const bindings = new StubAuthzManagedGrantRepository();
  bindings.findScopeRows.mockImplementation(async ({ scopes }) =>
    SCOPES.filter((row) =>
      scopes.some((scope) => scope.scopeType === row.type && scope.scopeId === row.id),
    ),
  );
  bindings.findOrganizationRole.mockImplementation(async ({ userId }) =>
    USERS.has(userId) ? "MEMBER" : null,
  );
  bindings.isGroupInOrganization.mockImplementation(async ({ groupId }) => groupId === "group-1");
  bindings.isApiKeyInOrganization.mockImplementation(async ({ apiKeyId }) => apiKeyId === "key-2");
  bindings.findAssignableRoles.mockImplementation(async ({ roleIds }) =>
    [
      { id: "customrole_ops", permissions: ["project:view"] },
      { id: "customrole_orgwide", permissions: ["organization:manage"] },
    ].filter((role) => roleIds.includes(role.id)),
  );
  bindings.findBinding.mockImplementation(async ({ bindingId }) => {
    const found = rows.find((row) => row.id === bindingId);
    return found ? { ...found, organizationId: ORG } : null;
  });
  const created = vi.fn();
  const ledger: AuthzCompatibilityLedger = {
    attachBindings: async (input) => {
      for (const binding of input.bindings) {
        created(binding);
        rows.push(
          row({
            id: binding.bindingId,
            userId: "userId" in binding.principal ? binding.principal.userId : null,
            groupId: "groupId" in binding.principal ? binding.principal.groupId : null,
            apiKeyId: "apiKeyId" in binding.principal ? binding.principal.apiKeyId : null,
            role: binding.role,
            customRoleId: binding.customRoleId,
            customRoleName: binding.customRoleId ? "Ops" : null,
            scopeType: binding.scopeType,
            scopeId: binding.scopeId,
            createdAt: new Date(Date.UTC(2026, 8, 2, 0, 0, next)),
            expiresAt: binding.expiresAtMs === undefined ? null : new Date(binding.expiresAtMs),
          }),
        );
      }
      return { attached: [], duplicates: [] };
    },
    changeBindingRole: async (input) => {
      const at = rows.findIndex((candidate) => candidate.id === input.bindingId);
      const current = rows[at];
      if (current) rows[at] = { ...current, role: input.role, customRoleId: input.customRoleId };
    },
    revokeBindings: async (input) => {
      for (const id of input.bindingIds)
        rows.splice(
          rows.findIndex((row) => row.id === id),
          1,
        );
    },
    attachResourceGrant: vi.fn(),
    revokeResourceGrants: vi.fn(),
    revokeBindingsWhere: vi.fn(),
    offboardMember: vi.fn(),
    defineRole: vi.fn(),
    deleteRole: vi.fn(),
  };
  const guards = {
    findPermissionsBeyondCaller: async (input: { permissions: string[] }) =>
      input.permissions.filter((permission) => lacks.includes(permission)),
    listManagedBindingsForOrganization: async () => [...rows],
  };
  const writer = AuthzGrantWriterService.create({
    bindings,
    ledger,
    newBindingId: () => `rb_${++next}`,
    permissions: guards,
  });
  const management = AuthzGrantManagementService.create({ writer, permissions: guards });
  const app = createAuthzTestApp({
    permissions: { listManagedBindingsForOrganization: guards.listManagedBindingsForOrganization },
    grants: {
      listGrants: (input) => management.list(input),
      getGrant: (input) => management.get(input),
      createGrant: (input) => management.create(input),
      changeGrantRole: (input) => management.changeRole(input),
      revokeGrant: (input) => management.revoke(input),
      createBinding: (input) => writer.create(input),
      updateBinding: (input) => writer.update(input),
      deleteBinding: (input) => writer.delete(input),
    },
  });

  const admit = () => ({
    actor: { type: "user" as const, id: "user-owner" },
    scope: { tier: "organization" as const, id: ORG },
  });
  const facts = () => ({
    organizationId: ORG,
    actor: { type: "user" as const, id: "user-owner" },
    caller: KEY,
  });
  const runtime = createRestRuntime({
    identity: {
      identify: admit,
      authenticate: admit,
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
    idempotency: memoryIdempotency(),
    entitlements: { holds: async () => enterprise },
    ...(deprecationLog ? { deprecationLog } : {}),
  });
  const onError = createCanonicalFamilyErrorHandler({
    loggerName: "langwatch:test:grants:errors",
    label: "Grants API Error",
  });
  const grantsHono = runtime.mount(authzGrantRest.router(), {
    app: () => app,
    onError,
    facts: [bindRestMiddleware(grantRestFacts, facts)],
  });
  const bindingsHono = runtime.mount(authzRoleBindingRest.router(), {
    app: () => app,
    onError,
    facts: [bindRestMiddleware(roleBindingRestFacts, facts)],
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    (path.startsWith("/api/role-bindings") ? bindingsHono : grantsHono).fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { send, rows, created };
}

function row(
  over: Partial<AuthzManagedOrganizationBinding> & Pick<AuthzManagedOrganizationBinding, "id">,
): AuthzManagedOrganizationBinding {
  return {
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
  };
}

const grantBody = (over: Record<string, unknown> = {}) => ({
  principal: { type: "user", id: "user-1" },
  roleId: "member",
  scope: { type: "team", id: "team-a" },
  ...over,
});

// First in the file: the runtime reports a deprecated route once per process, on its first call.
describe("given the deprecated /api/role-bindings family", () => {
  describe("when the family is listed twice", () => {
    /** @scenario The first call to a deprecated operation is logged once */
    it("reports the deprecated operation to the log once, naming the successor", async () => {
      const deprecatedRouteCalled = vi.fn();
      const { send } = world({ deprecationLog: { deprecatedRouteCalled } });

      await send("/api/role-bindings");
      await send("/api/role-bindings");

      expect(deprecatedRouteCalled).toHaveBeenCalledOnce();
      expect(deprecatedRouteCalled).toHaveBeenCalledWith(
        expect.objectContaining({
          family: "role-bindings",
          operation: "listRoleBindings",
          successor: "/api/grants",
        }),
      );
    });
  });

  describe("when each operation is called", () => {
    /** @scenario Every role bindings operation answers as before and carries the deprecation headers */
    it("answers as before with Deprecation and a successor Link naming /api/grants", async () => {
      const { send } = world({ rows: [row({ id: "rb_0", userId: "user-1" })] });

      const answers = [
        await send("/api/role-bindings"),
        await send("/api/role-bindings", {
          method: "POST",
          body: { userId: "user-2", role: "MEMBER", scopeType: "TEAM", scopeId: "team-a" },
        }),
        await send("/api/role-bindings/rb_0", { method: "PATCH", body: { role: "VIEWER" } }),
        await send("/api/role-bindings/rb_0", { method: "DELETE" }),
      ];

      expect(answers.map((response) => response.status)).toEqual([200, 201, 200, 200]);
      for (const response of answers) {
        expect(response.headers.get("Deprecation")).toBeTruthy();
        expect(response.headers.get("Link")).toContain("/api/grants");
      }
    });
  });

  describe("when the OpenAPI document is generated", () => {
    /** @scenario The published document marks the role bindings operations deprecated */
    it("marks every role bindings operation deprecated and no grants operation", () => {
      const bindings = authzRoleBindingRest.router();
      const grants = authzGrantRest.router();

      const bindingDocs = bindings.routes.map((route) =>
        restRouteDocumentation({
          route,
          deprecated: bindings.deprecated,
          credential: bindings.credential,
        }),
      );
      const grantDocs = grants.routes.map((route) =>
        restRouteDocumentation({
          route,
          deprecated: grants.deprecated,
          credential: grants.credential,
        }),
      );

      expect(bindingDocs.map((doc) => doc.operationId)).toEqual([
        "listRoleBindings",
        "createRoleBinding",
        "updateRoleBinding",
        "deleteRoleBinding",
      ]);
      expect(bindingDocs.every((doc) => doc.deprecated === true)).toBe(true);
      expect(bindingDocs.every((doc) => doc.description?.includes("/api/grants"))).toBe(true);
      expect(grantDocs.map((doc) => doc.operationId)).toEqual([
        "listGrants",
        "createGrant",
        "getGrant",
        "updateGrant",
        "revokeGrant",
      ]);
      expect(grantDocs.some((doc) => doc.deprecated === true)).toBe(false);
    });
  });
});

describe("given the /api/grants family", () => {
  describe("when a built-in role is granted to a user on a team", () => {
    /** @scenario Granting a built-in role to a user on a team */
    it("answers 201 naming the user, the built-in role and the team, active with no end", async () => {
      const { send } = world();

      const response = await send("/api/grants", { method: "POST", body: grantBody() });

      expect(response.status).toBe(201);
      expect(grantJson.parse(await response.json())).toMatchObject({
        principal: { type: "user", id: "user-1" },
        role: { id: "member", name: "Member", builtIn: true },
        scope: { type: "team", id: "team-a", name: "Team A" },
        status: "active",
        expiresAt: null,
      });
    });
  });

  describe("when a custom role is granted to a group on a project", () => {
    /** @scenario Granting a custom role to a group on a project */
    it("reads back the custom role by id and name, not built in", async () => {
      const { send } = world();

      const created = grantJson.parse(
        await (
          await send("/api/grants", {
            method: "POST",
            body: grantBody({
              principal: { type: "group", id: "group-1" },
              roleId: "customrole_ops",
              scope: { type: "project", id: "proj-1" },
            }),
          })
        ).json(),
      );
      const fetched = await send(`/api/grants/${created.id}`);

      expect(fetched.status).toBe(200);
      expect(grantJson.parse(await fetched.json())).toMatchObject({
        principal: { type: "group", id: "group-1" },
        role: { id: "customrole_ops", name: "Ops", builtIn: false },
      });
    });
  });

  describe("when a role is granted to an API key", () => {
    /** @scenario Granting a role to an API key */
    it("names the key as the principal", async () => {
      const { send } = world();

      const response = await send("/api/grants", {
        method: "POST",
        body: grantBody({
          principal: { type: "apiKey", id: "key-2" },
          roleId: "viewer",
          scope: { type: "project", id: "proj-1" },
        }),
      });

      expect(response.status).toBe(201);
      expect(grantJson.parse(await response.json()).principal).toMatchObject({
        type: "apiKey",
        id: "key-2",
      });
    });
  });

  describe("when grants are listed with filters, one page at a time", () => {
    /** @scenario Listing grants filters by principal, role, scope and status, one page at a time */
    it("pages one user's grants by cursor and narrows by role, scope and status", async () => {
      const { send } = world({
        rows: [
          row({ id: "g1", userId: "user-1", role: "VIEWER", scopeId: "team-a" }),
          row({
            id: "g2",
            userId: "user-1",
            role: "MEMBER",
            scopeId: "team-b",
            scopeName: "Team B",
          }),
          row({ id: "g3", groupId: "group-1", role: "VIEWER" }),
          row({ id: "g4", apiKeyId: "key-2", role: "VIEWER", expiresAt: new Date(1) }),
        ],
      });

      const first = pageJson.parse(
        await (await send("/api/grants?principalType=user&principalId=user-1&limit=1")).json(),
      );
      const second = pageJson.parse(
        await (
          await send(
            `/api/grants?principalType=user&principalId=user-1&limit=1&cursor=${first.nextCursor ?? ""}`,
          )
        ).json(),
      );
      const viewers = pageJson.parse(await (await send("/api/grants?roleId=viewer")).json());
      const teamB = pageJson.parse(
        await (await send("/api/grants?scopeType=team&scopeId=team-b")).json(),
      );
      const expired = pageJson.parse(await (await send("/api/grants?status=expired")).json());

      expect(first.grants.map((grant) => grant.id)).toEqual(["g1"]);
      expect(first.nextCursor).not.toBeNull();
      expect(second.grants.map((grant) => grant.id)).toEqual(["g2"]);
      expect(second.nextCursor).toBeNull();
      expect(viewers.grants.map((grant) => grant.id)).toEqual(["g1", "g3", "g4"]);
      expect(teamB.grants.map((grant) => grant.id)).toEqual(["g2"]);
      expect(expired.grants.map((grant) => grant.id)).toEqual(["g4"]);
    });

    /** @scenario A tampered page cursor is refused */
    it("refuses a cursor it never issued as invalid", async () => {
      const { send } = world();

      const response = await send("/api/grants?cursor=not-a-cursor");

      expect(response.status).toBe(422);
    });
  });

  describe("when grants are listed in either order", () => {
    /** @scenario Listing grants newest first, with oldest first as the default */
    it("lists oldest first by default, newest first on request, paging in either order", async () => {
      const at = (day: number) => new Date(Date.UTC(2026, 8, day));
      const { send } = world({
        rows: [
          row({ id: "g1", userId: "user-1", createdAt: at(1) }),
          row({ id: "g2", userId: "user-1", createdAt: at(2) }),
          row({ id: "g3", userId: "user-1", createdAt: at(3) }),
        ],
      });

      const byDefault = pageJson.parse(await (await send("/api/grants")).json());
      const oldest = pageJson.parse(await (await send("/api/grants?order=oldest")).json());
      const newest = pageJson.parse(await (await send("/api/grants?order=newest")).json());
      const first = pageJson.parse(await (await send("/api/grants?order=newest&limit=2")).json());
      const second = pageJson.parse(
        await (
          await send(`/api/grants?order=newest&limit=2&cursor=${first.nextCursor ?? ""}`)
        ).json(),
      );
      const invalid = await send("/api/grants?order=sideways");

      expect(byDefault.grants.map((grant) => grant.id)).toEqual(["g1", "g2", "g3"]);
      expect(oldest.grants.map((grant) => grant.id)).toEqual(["g1", "g2", "g3"]);
      expect(newest.grants.map((grant) => grant.id)).toEqual(["g3", "g2", "g1"]);
      expect(first.grants.map((grant) => grant.id)).toEqual(["g3", "g2"]);
      expect(second.grants.map((grant) => grant.id)).toEqual(["g1"]);
      expect(second.nextCursor).toBeNull();
      expect(invalid.status).toBe(422);
    });
  });

  describe("when a role is granted with an end date and then changed", () => {
    it("grants with an end date and changes the role, keeping the end date", async () => {
      const { send } = world();
      const endsAt = "2099-01-01T00:00:00.000Z";

      const created = await send("/api/grants", {
        method: "POST",
        body: grantBody({ expiresAt: endsAt }),
      });
      const grant = grantJson.parse(await created.json());
      const changed = await send(`/api/grants/${grant.id}`, {
        method: "PATCH",
        body: { roleId: "viewer" },
      });

      expect(created.status).toBe(201);
      expect(changed.status).toBe(200);
      expect(grantJson.parse(await changed.json())).toMatchObject({
        id: grant.id,
        role: { id: "viewer" },
        expiresAt: endsAt,
      });
    });
  });

  describe("when the organization is below Enterprise", () => {
    /** @scenario Both grant families answer 402 below Enterprise, naming the management API */
    it("refuses every grant route with enterprise_plan_required naming MANAGEMENT_API", async () => {
      const { send, created } = world({ enterprise: false });

      const answers = await Promise.all([
        send("/api/grants"),
        send("/api/grants", { method: "POST", body: grantBody() }),
        send("/api/role-bindings"),
      ]);

      for (const answer of answers) {
        expect(await answer.json()).toMatchObject({
          code: "enterprise_plan_required",
          meta: { feature: "MANAGEMENT_API" },
        });
      }
      expect(created).not.toHaveBeenCalled();
    });
  });

  describe("when a grant's role is changed", () => {
    /** @scenario Changing a grant's role keeps its principal and scope */
    it("keeps the id, principal and scope", async () => {
      const { send } = world({
        rows: [
          row({
            id: "g1",
            userId: "user-1",
            role: "VIEWER",
            scopeType: "PROJECT",
            scopeId: "proj-1",
          }),
        ],
      });

      const response = await send("/api/grants/g1", {
        method: "PATCH",
        body: { roleId: "member" },
      });

      expect(response.status).toBe(200);
      expect(grantJson.parse(await response.json())).toMatchObject({
        id: "g1",
        principal: { type: "user", id: "user-1" },
        role: { id: "member" },
        scope: { type: "project", id: "proj-1" },
      });
    });

    /** @scenario A grant's principal and scope cannot be changed */
    it("refuses a body naming a scope and leaves the grant", async () => {
      const { send, rows } = world({ rows: [row({ id: "g1", userId: "user-1", role: "VIEWER" })] });

      const response = await send("/api/grants/g1", {
        method: "PATCH",
        body: { roleId: "viewer", scope: { type: "team", id: "team-b" } },
      });

      expect(response.status).toBe(422);
      expect(rows[0]?.scopeId).toBe("team-a");
    });
  });

  describe("when a grant is revoked", () => {
    /** @scenario Revoking a grant */
    it("answers 200 naming the revoked id", async () => {
      const { send, rows } = world({ rows: [row({ id: "g1", userId: "user-1" })] });

      const response = await send("/api/grants/g1", { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: "g1", revoked: true });
      expect(rows).toHaveLength(0);
    });
  });

  describe("when the same grant is made twice", () => {
    /** @scenario The same grant can be made twice */
    it("creates a second grant with a different id", async () => {
      const { send } = world();

      const first = grantJson.parse(
        await (await send("/api/grants", { method: "POST", body: grantBody() })).json(),
      );
      const second = await send("/api/grants", { method: "POST", body: grantBody() });

      expect(second.status).toBe(201);
      expect(grantJson.parse(await second.json()).id).not.toBe(first.id);
    });
  });

  describe("when a create is retried under an Idempotency-Key", () => {
    /** @scenario A retried create with the same Idempotency-Key makes one grant */
    it("replays the first answer and makes one grant", async () => {
      const { send, created } = world();
      const headers = { "Idempotency-Key": "grant-key-0001" };

      const first = await send("/api/grants", { method: "POST", body: grantBody(), headers });
      const second = await send("/api/grants", { method: "POST", body: grantBody(), headers });

      expect(grantJson.parse(await second.json()).id).toBe(grantJson.parse(await first.json()).id);
      expect(second.headers.get("X-Idempotent-Replay")).toBe("true");
      expect(created).toHaveBeenCalledOnce();
    });

    /** @scenario Reusing an Idempotency-Key with a different body is refused */
    it("refuses a different body under the same key and makes no second grant", async () => {
      const { send, created } = world();
      const headers = { "Idempotency-Key": "grant-key-0002" };

      await send("/api/grants", { method: "POST", body: grantBody(), headers });
      const reused = await send("/api/grants", {
        method: "POST",
        body: grantBody({ roleId: "viewer" }),
        headers,
      });

      expect(reused.status).toBe(409);
      expect(errorJson.parse(await reused.json()).code).toBe("idempotency_error");
      expect(created).toHaveBeenCalledOnce();
    });
  });

  describe("when a grant names something outside the organization", () => {
    /** @scenario A grant naming something outside the organization is refused */
    it.each([
      {
        thing: "a user",
        body: grantBody({ principal: { type: "user", id: "user-foreign" } }),
        code: "grant_principal_not_found",
      },
      {
        thing: "a group",
        body: grantBody({ principal: { type: "group", id: "group-foreign" } }),
        code: "grant_principal_not_found",
      },
      {
        thing: "an API key",
        body: grantBody({ principal: { type: "apiKey", id: "key-foreign" } }),
        code: "grant_principal_not_found",
      },
      {
        thing: "a custom role",
        body: grantBody({ roleId: "customrole_foreign" }),
        code: "grant_role_not_found",
      },
      {
        thing: "a team",
        body: grantBody({ scope: { type: "team", id: "team-foreign" } }),
        code: "grant_scope_not_found",
      },
    ])("refuses $thing with $code and writes nothing", async ({ body, code }) => {
      const { send, created } = world();

      const response = await send("/api/grants", { method: "POST", body });

      expect(response.status).toBe(422);
      expect(errorJson.parse(await response.json()).code).toBe(code);
      expect(created).not.toHaveBeenCalled();
    });
  });

  describe("when a role with an organization-only permission is granted on a team", () => {
    /** @scenario A role with an organization-only permission cannot be granted below the organization */
    it("refuses with grant_scope_not_allowed and writes nothing", async () => {
      const { send, created } = world();

      const response = await send("/api/grants", {
        method: "POST",
        body: grantBody({ roleId: "customrole_orgwide" }),
      });

      expect(response.status).toBe(422);
      expect(errorJson.parse(await response.json()).code).toBe("grant_scope_not_allowed");
      expect(created).not.toHaveBeenCalled();
    });
  });

  describe("when a grant reaches into a personal workspace or ends in the past", () => {
    /** @scenario A grant into a personal workspace is refused */
    it("refuses a personal workspace with grant_scope_personal_workspace", async () => {
      const { send } = world();

      const response = await send("/api/grants", {
        method: "POST",
        body: grantBody({ scope: { type: "team", id: "team-ana" } }),
      });

      expect(response.status).toBe(403);
      expect(errorJson.parse(await response.json()).code).toBe("grant_scope_personal_workspace");
    });

    /** @scenario A grant ending in the past is refused */
    it("refuses a past end date with grant_expiry_in_past", async () => {
      const { send } = world();

      const response = await send("/api/grants", {
        method: "POST",
        body: grantBody({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      });

      expect(response.status).toBe(422);
      expect(errorJson.parse(await response.json()).code).toBe("grant_expiry_in_past");
    });
  });

  describe("when the body is malformed or oversized", () => {
    /** @scenario A malformed or oversized grant is refused before anything is written */
    it.each([
      {
        name: "an unknown principal type",
        body: grantBody({ principal: { type: "robot", id: "r-1" } }),
      },
      {
        name: "an oversized id",
        body: grantBody({ principal: { type: "user", id: "u".repeat(129) } }),
      },
      { name: "an unknown field", body: { ...grantBody(), admin: true } },
    ])("refuses $name as invalid", async ({ body }) => {
      const { send, created } = world();

      const response = await send("/api/grants", { method: "POST", body });

      expect(response.status).toBe(422);
      expect(created).not.toHaveBeenCalled();
    });
  });

  describe("when a grant id belongs to another organization", () => {
    /** @scenario An unknown or foreign grant id is not found */
    it("answers grant_not_found to a fetch, a change and a delete", async () => {
      const { send } = world();

      const answers = await Promise.all([
        send("/api/grants/rb_foreign"),
        send("/api/grants/rb_foreign", { method: "PATCH", body: { roleId: "viewer" } }),
        send("/api/grants/rb_foreign", { method: "DELETE" }),
      ]);

      for (const response of answers) {
        expect(response.status).toBe(404);
        expect(errorJson.parse(await response.json()).code).toBe("grant_not_found");
      }
    });
  });

  describe("when the caller would grant beyond their own permissions", () => {
    it("refuses on both doors with grant_exceeds_caller_permissions", async () => {
      const { send, created } = world({ lacks: ["project:delete"] });

      const viaGrants = await send("/api/grants", {
        method: "POST",
        body: grantBody({ roleId: "admin" }),
      });
      const viaBindings = await send("/api/role-bindings", {
        method: "POST",
        body: { userId: "user-1", role: "ADMIN", scopeType: "TEAM", scopeId: "team-a" },
      });

      for (const response of [viaGrants, viaBindings]) {
        expect(response.status).toBe(403);
        expect(errorJson.parse(await response.json())).toMatchObject({
          code: "grant_exceeds_caller_permissions",
        });
      }
      expect(created).not.toHaveBeenCalled();
    });
  });
});
