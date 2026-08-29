/**
 * The `/api/groups` REST door: the access policy every route declares, the
 * Enterprise gate that runs after it, the wire body, and the status a domain
 * refusal becomes.
 *
 * Ported from `platform/app/src/app/api/groups/__tests__/`:
 * `groups-rest-api.integration.test.ts` and
 * `groups-enterprise-gate.integration.test.ts`, both of which drove this family
 * against real Postgres. What they proved about the SERVICE — that a group its
 * identity provider owns cannot be renamed here, that a member has to belong to
 * the organization — is in `group.service.unit.test.ts`, where the rule lives.
 * What is asserted here is that the door dispatches to it, attributes the write,
 * and renders the refusal with its own status and code.
 *
 * Spec: specs/groups/groups-rest-api.feature
 *       specs/licensing/management-apis-enterprise-gate.feature
 */
import {
  createRestApiService,
  type AppRestOrganizationVariables,
  type AppRestProjectVariables,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  GroupNotFoundError,
  ScimManagedGroupError,
  UserNotInOrganizationError,
  type OrganizationGroup,
  type OrganizationGroupBinding,
  type OrganizationGroupDetails,
  type OrganizationGroupPage,
  type OrganizationLedgerActor,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";
import { createGroupRestApp } from "../group.api";
import { TestOrganizationService } from "./support/test-organization-service";

const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";
const CREDENTIAL = "organization-credential";
const NOW = new Date("2026-08-24T00:00:00.000Z");

/** Who a REST write is attributed to in the grants ledger. */
const LEDGER_ACTOR: OrganizationLedgerActor = { type: "user", id: USER_ID };

const binding: OrganizationGroupBinding = {
  id: "binding-1",
  role: "MEMBER",
  customRoleId: null,
  customRoleName: null,
  scopeType: "TEAM",
  scopeId: "team-1",
};

function group(overrides: Partial<OrganizationGroup> = {}): OrganizationGroup {
  return {
    id: "group-1",
    organizationId: ORGANIZATION_ID,
    name: "Reviewers",
    slug: "reviewers",
    externalId: null,
    scimSource: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function groupDetails(overrides: Partial<OrganizationGroupDetails> = {}): OrganizationGroupDetails {
  return {
    ...group(),
    members: [{ userId: USER_ID, name: "Alex", email: "alex@example.com", image: null }],
    bindings: [binding],
    ...overrides,
  };
}

function groupPage(): OrganizationGroupPage {
  return {
    data: [{ ...group(), memberCount: 2, bindings: [binding] }],
    pagination: { page: 1, limit: 50, total: 1 },
  };
}

/**
 * The process's enforcement, plus the two ports this family declares.
 *
 * The Enterprise gate is applied per route AFTER the access chain, so an
 * unauthenticated request must still answer 401 rather than 402 — "you are not
 * who you say" comes before "your plan does not include this". `entitled: false`
 * is what drives that ordering assertion.
 */
function spine(options: { granted?: readonly string[] } = {}) {
  const granted = new Set(options.granted ?? ["organization:manage"]);

  const authenticateOrganization: MiddlewareHandler = async (c, next) => {
    if (c.req.header("Authorization") !== `Bearer ${CREDENTIAL}`) {
      return c.json({ error: "Unauthorized", message: "Invalid credential" }, 401);
    }
    c.set("organization", { id: ORGANIZATION_ID });
    c.set("apiKeyId", "api-key-1");
    c.set("apiKeyUserId", USER_ID);
    c.set("apiKeyOrganizationId", ORGANIZATION_ID);
    c.set("orgResolvedToken", {
      type: "apiKey-org",
      apiKeyId: "api-key-1",
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      if (HandledError.isHandled(error)) {
        return c.json(
          { error: error.code, message: error.message },
          (error.httpStatus ?? 500) as ContentfulStatusCode,
        );
      }
      return c.json({ error: "Internal server error" }, 500);
    },
    canonicalErrorHandler: (error, c) => c.json({ error: { message: error.message } }, 500),
    authenticateProject: () => async (_c, next) => next(),
    authorizeProjectPermission: () => async (_c, next) => next(),
    authorizeApiKeyCeiling: () => async (_c, next) => next(),
    authenticateOrganization: () => authenticateOrganization,
    authorizeOrganizationPermission:
      ({ permission }) =>
      async (c, next) => {
        if (!granted.has(permission)) {
          return c.json({ error: "Forbidden", message: "Missing permission" }, 403);
        }
        await next();
      },
    authorizeRouteProjectPermission: () => async (_c, next) => next(),
    authenticateOrganizationThrowing: async (_c, next) => next(),
    authorizeOrganizationPermissionThrowing: () => async (_c, next) => next(),
  };

  return createRestApiService<AppRestProjectVariables, AppRestOrganizationVariables>(ports);
}

function buildApi(
  options: {
    organizations?: Partial<TestOrganizationService>;
    granted?: readonly string[];
    entitled?: boolean;
  } = {},
) {
  const organizations: OrganizationService = Object.assign(
    new TestOrganizationService(),
    options.organizations,
  );
  const gateRefusals: string[] = [];
  const enterpriseGate: MiddlewareHandler = async (c, next) => {
    if (options.entitled === false) {
      gateRefusals.push(c.req.path);
      return c.json(
        { error: "enterprise_plan_required", message: "Groups are an Enterprise capability" },
        402,
      );
    }
    await next();
  };

  const { hono } = createGroupRestApp({
    security: spine(options.granted ? { granted: options.granted } : {}),
    organizations: () => organizations,
    enterpriseGate,
    ledgerActor: () => LEDGER_ACTOR,
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string } = {},
  ) =>
    hono.request(path, {
      ...(init.method === undefined ? {} : { method: init.method }),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: {
        Authorization: `Bearer ${init.credential ?? CREDENTIAL}`,
        "Content-Type": "application/json",
      },
    });

  return { hono, send, gateRefusals };
}

describe("createGroupRestApp", () => {
  describe("given no credential", () => {
    /** @scenario GET /api/groups returns 401 without auth */
    it("refuses before the request reaches the service", async () => {
      const listGroups = vi.fn(async () => groupPage());
      const { hono } = buildApi({ organizations: { listGroups } });

      const response = await hono.request("/api/groups");

      expect(response.status).toBe(401);
      expect(listGroups).not.toHaveBeenCalled();
    });

    /**
     * The plan gate runs after the access chain, so a request with no
     * credential is refused as unauthenticated even on an unentitled
     * organization. "You are not who you say" beats "your plan does not
     * include this".
     */
    it("stays a 401 rather than a plan refusal on an unentitled organization", async () => {
      const { hono, gateRefusals } = buildApi({ entitled: false });

      expect((await hono.request("/api/groups")).status).toBe(401);
      expect(gateRefusals).toEqual([]);
    });
  });

  describe("given an organization whose plan does not include groups", () => {
    it("refuses a fully permissioned credential with the plan's own code", async () => {
      const listGroups = vi.fn(async () => groupPage());
      const { send } = buildApi({ organizations: { listGroups }, entitled: false });

      const response = await send("/api/groups");

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({
        error: "enterprise_plan_required",
      });
      expect(listGroups).not.toHaveBeenCalled();
    });
  });

  describe("given a credential without organization:manage", () => {
    it("refuses, and does so before the plan is consulted", async () => {
      const { send, gateRefusals } = buildApi({ granted: [], entitled: false });

      expect((await send("/api/groups")).status).toBe(403);
      expect(gateRefusals).toEqual([]);
    });
  });

  describe("when the collection is listed", () => {
    /** @scenario GET /api/groups lists all groups */
    it("answers with each group, its member count and its bindings", async () => {
      const listGroups = vi.fn(async () => groupPage());
      const { send } = buildApi({ organizations: { listGroups } });

      const response = await send("/api/groups");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [
          {
            id: "group-1",
            name: "Reviewers",
            slug: "reviewers",
            externalId: null,
            scimSource: null,
            memberCount: 2,
            bindings: [
              {
                id: "binding-1",
                role: "MEMBER",
                customRoleId: null,
                customRoleName: null,
                scopeType: "TEAM",
                scopeId: "team-1",
              },
            ],
            createdAt: NOW.toISOString(),
          },
        ],
        pagination: { page: 1, limit: 50, total: 1 },
      });
    });

    /** @scenario GET /api/groups returns paginated results */
    it("passes the requested page and limit through", async () => {
      const listGroups = vi.fn(async () => groupPage());
      const { send } = buildApi({ organizations: { listGroups } });

      await send("/api/groups?page=2&limit=1");

      expect(listGroups).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        page: 2,
        limit: 1,
      });
    });
  });

  describe("when a group is created", () => {
    /** @scenario POST /api/groups creates a group */
    it("answers 201 and attributes the write to the caller", async () => {
      const createGroup = vi.fn(async () => group());
      const { send } = buildApi({ organizations: { createGroup } });

      const response = await send("/api/groups", {
        method: "POST",
        body: { name: "Reviewers" },
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        id: "group-1",
        name: "Reviewers",
        slug: "reviewers",
        organizationId: ORGANIZATION_ID,
        createdAt: NOW.toISOString(),
      });
      expect(createGroup).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, actor: LEDGER_ACTOR }),
      );
    });

    /** @scenario POST /api/groups creates a group with initial members and bindings */
    it("sends the initial members and bindings through as they arrived", async () => {
      const createGroup = vi.fn(async () => group());
      const { send } = buildApi({ organizations: { createGroup } });

      await send("/api/groups", {
        method: "POST",
        body: {
          name: "Reviewers",
          memberIds: [USER_ID],
          bindings: [{ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
        },
      });

      expect(createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          memberIds: [USER_ID],
          bindings: [{ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
        }),
      );
    });

    /** @scenario POST /api/groups returns 422 for missing name */
    it("refuses a body with no name and writes nothing", async () => {
      const createGroup = vi.fn(async () => group());
      const { send } = buildApi({ organizations: { createGroup } });

      const response = await send("/api/groups", { method: "POST", body: {} });

      expect(response.status).toBe(422);
      expect(createGroup).not.toHaveBeenCalled();
    });
  });

  describe("when one group is read", () => {
    /** @scenario GET /api/groups/:id returns group with members and bindings */
    it("answers with its members and its bindings", async () => {
      const getGroup = vi.fn(async () => groupDetails());
      const { send } = buildApi({ organizations: { getGroup } });

      const response = await send("/api/groups/group-1");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "group-1",
        name: "Reviewers",
        slug: "reviewers",
        externalId: null,
        scimSource: null,
        members: [{ userId: USER_ID, name: "Alex", email: "alex@example.com" }],
        bindings: [
          {
            id: "binding-1",
            role: "MEMBER",
            customRoleId: null,
            customRoleName: null,
            scopeType: "TEAM",
            scopeId: "team-1",
          },
        ],
      });
      expect(getGroup).toHaveBeenCalledWith({
        groupId: "group-1",
        organizationId: ORGANIZATION_ID,
      });
    });

    /** @scenario GET /api/groups/:id returns 404 for nonexistent group */
    it("reports an unknown id as not found", async () => {
      const { send } = buildApi({
        organizations: {
          getGroup: vi.fn(async (): Promise<OrganizationGroupDetails> => {
            throw new GroupNotFoundError("nonexistent");
          }),
        },
      });

      const response = await send("/api/groups/nonexistent");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "group_not_found" });
    });
  });

  describe("when a group is renamed", () => {
    /** @scenario PATCH /api/groups/:id renames a group */
    it("answers with the new name and slug", async () => {
      const renameGroup = vi.fn(async () =>
        group({ name: "Renamed Group", slug: "renamed-group" }),
      );
      const { send } = buildApi({ organizations: { renameGroup } });

      const response = await send("/api/groups/group-1", {
        method: "PATCH",
        body: { name: "Renamed Group" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "group-1",
        name: "Renamed Group",
        slug: "renamed-group",
      });
    });

    /**
     * @scenario PATCH /api/groups/:id rejects rename of SCIM-managed group
     *
     * A conflict with the directory that owns the group, not a malformed
     * request: the name would come back on the next sync.
     */
    it("reports a directory-managed group as a conflict", async () => {
      const { send } = buildApi({
        organizations: {
          renameGroup: vi.fn(async (): Promise<OrganizationGroup> => {
            throw new ScimManagedGroupError("group-1");
          }),
        },
      });

      const response = await send("/api/groups/group-1", {
        method: "PATCH",
        body: { name: "New Name" },
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "scim_managed_group" });
    });
  });

  describe("when a group is deleted", () => {
    /** @scenario DELETE /api/groups/:id deletes a group */
    it("answers success and attributes the write to the caller", async () => {
      const deleteGroup = vi.fn(async () => undefined);
      const { send } = buildApi({ organizations: { deleteGroup } });

      const response = await send("/api/groups/group-1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(deleteGroup).toHaveBeenCalledWith({
        groupId: "group-1",
        organizationId: ORGANIZATION_ID,
        actor: LEDGER_ACTOR,
      });
    });

    /** @scenario DELETE /api/groups/:id rejects deleting a SCIM-managed group */
    it("reports a directory-managed group as a conflict", async () => {
      const { send } = buildApi({
        organizations: {
          deleteGroup: vi.fn(async (): Promise<void> => {
            throw new ScimManagedGroupError("group-1");
          }),
        },
      });

      const response = await send("/api/groups/group-1", { method: "DELETE" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "scim_managed_group" });
    });

    /** @scenario DELETE /api/groups/:id returns 404 for nonexistent group */
    it("reports an unknown id as not found", async () => {
      const { send } = buildApi({
        organizations: {
          deleteGroup: vi.fn(async (): Promise<void> => {
            throw new GroupNotFoundError("nonexistent");
          }),
        },
      });

      expect((await send("/api/groups/nonexistent", { method: "DELETE" })).status).toBe(404);
    });
  });

  describe("when a group's membership changes", () => {
    /** @scenario POST /api/groups/:id/members adds a member */
    it("answers 201 when a member is added", async () => {
      const addGroupMember = vi.fn(async () => undefined);
      const { send } = buildApi({ organizations: { addGroupMember } });

      const response = await send("/api/groups/group-1/members", {
        method: "POST",
        body: { userId: USER_ID },
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(addGroupMember).toHaveBeenCalledWith({
        groupId: "group-1",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
      });
    });

    /** @scenario GET /api/groups/:id/members lists group members */
    it("lists them from the same read the detail route serves", async () => {
      const getGroup = vi.fn(async () => groupDetails());
      const { send } = buildApi({ organizations: { getGroup } });

      const response = await send("/api/groups/group-1/members");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [{ userId: USER_ID, name: "Alex", email: "alex@example.com" }],
      });
    });

    /** @scenario DELETE /api/groups/:id/members/:userId removes a member */
    it("answers success when a member is removed", async () => {
      const removeGroupMember = vi.fn(async () => undefined);
      const { send } = buildApi({ organizations: { removeGroupMember } });

      const response = await send(`/api/groups/group-1/members/${USER_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(removeGroupMember).toHaveBeenCalledWith({
        groupId: "group-1",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
      });
    });

    /** @scenario POST /api/groups/:id/members rejects adding to SCIM-managed group */
    it("reports adding to a directory-managed group as a conflict", async () => {
      const { send } = buildApi({
        organizations: {
          addGroupMember: vi.fn(async (): Promise<void> => {
            throw new ScimManagedGroupError("group-1");
          }),
        },
      });

      const response = await send("/api/groups/group-1/members", {
        method: "POST",
        body: { userId: USER_ID },
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "scim_managed_group" });
    });

    /** @scenario DELETE /api/groups/:id/members/:userId rejects removal from SCIM group */
    it("reports removing from a directory-managed group as a conflict", async () => {
      const { send } = buildApi({
        organizations: {
          removeGroupMember: vi.fn(async (): Promise<void> => {
            throw new ScimManagedGroupError("group-1");
          }),
        },
      });

      const response = await send(`/api/groups/group-1/members/${USER_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(409);
    });

    /**
     * @scenario POST /api/groups/:id/members rejects non-org user
     *
     * Well-formed, but names somebody this organization does not have.
     *
     * The status is 404, not the 422 the old REST suite asserted. Two classes
     * carry this one code and they disagree: the organization contract's
     * (`packages/features/organization/contract/src/team.errors.ts`) extends
     * `NotFoundError`, which forces 404, and the role-bindings family's
     * (`platform/app/src/server/role-bindings/errors.ts`) sets 422. The
     * repository behind this route throws the contract's, so 404 is what a
     * caller receives; the code, which is what the client renders copy from,
     * is the same either way. Asserted as it behaves, with the disagreement
     * named rather than hidden.
     */
    it("reports somebody outside the organization as not a member", async () => {
      const { send } = buildApi({
        organizations: {
          addGroupMember: vi.fn(async (): Promise<void> => {
            throw new UserNotInOrganizationError("outsider");
          }),
        },
      });

      const response = await send("/api/groups/group-1/members", {
        method: "POST",
        body: { userId: "outsider" },
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "user_not_in_organization",
      });
    });

    it("refuses a members body with no userId and writes nothing", async () => {
      const addGroupMember = vi.fn(async () => undefined);
      const { send } = buildApi({ organizations: { addGroupMember } });

      const response = await send("/api/groups/group-1/members", {
        method: "POST",
        body: {},
      });

      expect(response.status).toBe(422);
      expect(addGroupMember).not.toHaveBeenCalled();
    });
  });

  describe("when a group's bindings change", () => {
    /** @scenario POST /api/groups/:id/bindings adds a role binding */
    it("answers 201 and attributes the write to the caller", async () => {
      const addGroupBinding = vi.fn(async () => binding);
      const { send } = buildApi({ organizations: { addGroupBinding } });

      const response = await send("/api/groups/group-1/bindings", {
        method: "POST",
        body: { role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" },
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        id: "binding-1",
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: "team-1",
      });
      expect(addGroupBinding).toHaveBeenCalledWith({
        groupId: "group-1",
        organizationId: ORGANIZATION_ID,
        binding: { role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" },
        actor: LEDGER_ACTOR,
      });
    });

    /** @scenario GET /api/groups/:id/bindings lists group role bindings */
    it("lists them with the role each one grants", async () => {
      const listGroupBindings = vi.fn(async () => [binding]);
      const { send } = buildApi({ organizations: { listGroupBindings } });

      const response = await send("/api/groups/group-1/bindings");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [
          {
            id: "binding-1",
            role: "MEMBER",
            customRoleId: null,
            customRoleName: null,
            scopeType: "TEAM",
            scopeId: "team-1",
          },
        ],
      });
    });

    it("answers success when a binding is removed, attributed to the caller", async () => {
      const removeGroupBinding = vi.fn(async () => undefined);
      const { send } = buildApi({ organizations: { removeGroupBinding } });

      const response = await send("/api/groups/group-1/bindings/binding-1", {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(removeGroupBinding).toHaveBeenCalledWith({
        groupId: "group-1",
        bindingId: "binding-1",
        organizationId: ORGANIZATION_ID,
        actor: LEDGER_ACTOR,
      });
    });
  });
});
