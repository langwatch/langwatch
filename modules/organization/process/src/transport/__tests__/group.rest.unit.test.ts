import {
  bindRestMiddleware,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  UnauthorizedError,
} from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * `/api/groups` on a real declaration over an application fixture: what each route
 * asks of the application and how it answers.
 * @see specs/groups/groups-rest-api.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import {
  GroupBindingNotFoundError,
  GroupNotFoundError,
  type OrganizationApi,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { groupsRest } from "../group.rest.ts";
import { organizationKeyFacts } from "../organization-management.rest.ts";

const ORGANIZATION_ID = "organization-1";
const CREDENTIAL = "organization-credential";
const KEY_ID = "key-1";
const OWNER_CALLER = { id: "user-owner", apiKeyId: KEY_ID };
const CREATED_AT = new Date("2026-09-01T00:00:00.000Z");

const onError = createCanonicalFamilyErrorHandler({
  loggerName: "langwatch:test:groups:errors",
  label: "Groups API Error",
});

/** `owner: null` is a service key: the runtime hands over no actor (api-surface.ts keyOwner). */
function mount(
  app: Partial<OrganizationApi>,
  { owner = "user-owner", enterprise = true }: { owner?: string | null; enterprise?: boolean } = {},
) {
  const admit = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }
    return {
      actor: owner ? { type: "user" as const, id: owner } : null,
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
  const hono = runtime.mount(groupsRest.router(), {
    app: () => createApiFixture<OrganizationApi>(app),
    onError,
    facts: [bindRestMiddleware(organizationKeyFacts, () => ({ apiKeyId: KEY_ID }))],
  });

  return (
    path: string,
    init: { method?: string; body?: unknown; credential?: string | null } = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(init.credential === null
            ? {}
            : { Authorization: `Bearer ${init.credential ?? CREDENTIAL}` }),
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
}

const binding = {
  id: "rb_123",
  role: "MEMBER" as const,
  customRoleId: null,
  customRoleName: null,
  scopeType: "TEAM" as const,
  scopeId: "team-backend",
};

const summary = (name: string, memberCount: number) => ({
  id: `group_${name}`,
  organizationId: ORGANIZATION_ID,
  name,
  slug: name.toLowerCase(),
  externalId: null,
  scimSource: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  memberCount,
  grants: [binding],
});

const alice = { userId: "alice-id", name: "Alice", email: "alice@acme.test", image: null };

describe("given the /api/groups family", () => {
  describe("when the organization is below Enterprise", () => {
    /** @scenario The groups family answers 402 below Enterprise, naming GROUPS */
    it("refuses with enterprise_plan_required naming GROUPS before reaching the app", async () => {
      const listGroups = vi.fn();
      const send = mount({ listGroups }, { enterprise: false });

      const answer = await send("/api/groups");

      expect(await answer.json()).toMatchObject({
        code: "enterprise_plan_required",
        meta: { feature: "GROUPS" },
      });
      expect(listGroups).not.toHaveBeenCalled();
    });
  });

  describe("when the organization's groups are listed", () => {
    /** @scenario GET /api/groups lists all groups */
    it("answers both groups with their member counts and bindings", async () => {
      const send = mount({
        listGroups: async () => ({
          data: [summary("Engineering", 3), summary("Design", 1)],
          pagination: { page: 1, limit: 50, total: 2 },
        }),
      });

      const response = await send("/api/groups");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: Record<string, unknown>[] };
      expect(body.data.map((group) => [group.name, group.memberCount])).toEqual([
        ["Engineering", 3],
        ["Design", 1],
      ]);
      expect(body.data[0]?.bindings).toEqual([binding]);
    });

    /** @scenario GET /api/groups returns paginated results */
    it("hands the page and limit through and answers the pagination metadata", async () => {
      const listGroups = vi.fn(async () => ({
        data: [summary("Engineering", 3)],
        pagination: { page: 1, limit: 10, total: 1 },
      }));
      const send = mount({ listGroups });

      const response = await send("/api/groups?page=1&limit=10");

      expect(response.status).toBe(200);
      expect(listGroups).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        page: 1,
        limit: 10,
      });
      await expect(response.json()).resolves.toMatchObject({
        pagination: { page: 1, limit: 10, total: 1 },
      });
    });

    /** @scenario GET /api/groups returns 401 without auth */
    it("answers 401 to a caller with no credential", async () => {
      const send = mount({});

      expect((await send("/api/groups", { credential: null })).status).toBe(401);
    });
  });

  describe("when a group is created", () => {
    const created = {
      id: "group_new",
      organizationId: ORGANIZATION_ID,
      name: "Backend Team",
      slug: "backend-team",
      externalId: null,
      scimSource: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };

    /** @scenario POST /api/groups creates a group */
    it("answers 201 with the group and its generated slug", async () => {
      const send = mount({ createGroup: async () => created });

      const response = await send("/api/groups", {
        method: "POST",
        body: { name: "Backend Team" },
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: "group_new",
        name: "Backend Team",
        slug: "backend-team",
      });
    });

    /** @scenario POST /api/groups creates a group with initial members and bindings */
    it("hands the initial members and bindings to the application", async () => {
      const createGroup = vi.fn(async () => created);
      const send = mount({ createGroup });
      const bindings = [{ role: "MEMBER", scopeType: "TEAM", scopeId: "eng-team-id" }];

      const response = await send("/api/groups", {
        method: "POST",
        body: { name: "Full Team", memberIds: ["alice-user-id"], bindings },
      });

      expect(response.status).toBe(201);
      expect(createGroup).toHaveBeenCalledWith(
        {
          organizationId: ORGANIZATION_ID,
          name: "Full Team",
          grants: bindings,
          memberIds: ["alice-user-id"],
        },
        OWNER_CALLER,
      );
    });

    /** @scenario POST /api/groups returns 422 for missing name */
    it("refuses an empty name by name and creates nothing", async () => {
      const createGroup = vi.fn();
      const send = mount({ createGroup });

      const response = await send("/api/groups", { method: "POST", body: { name: "" } });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: "validation_error" });
      expect(createGroup).not.toHaveBeenCalled();
    });
  });

  describe("when one group is read", () => {
    /** @scenario GET /api/groups/:id returns group with members and bindings */
    it("answers its members with userId, name and email, and its bindings", async () => {
      const send = mount({
        getGroup: async () => ({ ...summary("Engineering", 1), members: [alice] }),
      });

      const response = await send("/api/groups/group_Engineering");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { members: unknown[]; bindings: unknown[] };
      expect(body.members).toEqual([
        { userId: "alice-id", name: "Alice", email: "alice@acme.test" },
      ]);
      expect(body.bindings).toEqual([binding]);
    });

    /** @scenario GET /api/groups/:id returns 404 for nonexistent group */
    it("answers 404 group_not_found for a group that does not exist", async () => {
      const send = mount({
        getGroup: async () => {
          throw new GroupNotFoundError("nonexistent");
        },
      });

      const response = await send("/api/groups/nonexistent");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "group_not_found" });
    });
  });

  describe("when a group is renamed", () => {
    /** @scenario PATCH /api/groups/:id renames a group */
    it("answers the new name and the updated slug", async () => {
      const renameGroup = vi.fn(async () => ({
        ...summary("New Name", 0),
        name: "New Name",
        slug: "new-name",
      }));
      const send = mount({ renameGroup });

      const response = await send("/api/groups/group_1", {
        method: "PATCH",
        body: { name: "New Name" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "group_New Name",
        name: "New Name",
        slug: "new-name",
      });
      expect(renameGroup).toHaveBeenCalledWith({
        groupId: "group_1",
        organizationId: ORGANIZATION_ID,
        name: "New Name",
      });
    });
  });

  describe("when a group is deleted", () => {
    /** @scenario DELETE /api/groups/:id deletes a group */
    it("answers 200 and asks the application to delete it", async () => {
      const deleteGroup = vi.fn(async () => {});
      const send = mount({ deleteGroup });

      const response = await send("/api/groups/group_temp", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(deleteGroup).toHaveBeenCalledWith(
        { groupId: "group_temp", organizationId: ORGANIZATION_ID },
        OWNER_CALLER,
      );
    });

    /** @scenario DELETE /api/groups/:id returns 404 for nonexistent group */
    it("answers 404 for a group that does not exist", async () => {
      const send = mount({
        deleteGroup: async () => {
          throw new GroupNotFoundError("nonexistent");
        },
      });

      expect((await send("/api/groups/nonexistent", { method: "DELETE" })).status).toBe(404);
    });
  });

  describe("when a group's members are read and changed", () => {
    /** @scenario GET /api/groups/:id/members lists group members */
    it("lists each member with userId, name and email", async () => {
      const bob = { userId: "bob-id", name: "Bob", email: "bob@acme.test", image: null };
      const send = mount({
        getGroup: async () => ({ ...summary("Engineering", 2), members: [alice, bob] }),
      });

      const response = await send("/api/groups/group_1/members");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { userId: string }[] };
      expect(body.data.map((member) => member.userId)).toEqual(["alice-id", "bob-id"]);
    });

    /** @scenario POST /api/groups/:id/members adds a member */
    it("answers 201 and hands the member to the application", async () => {
      const addGroupMember = vi.fn(async () => {});
      const send = mount({ addGroupMember });

      const response = await send("/api/groups/group_1/members", {
        method: "POST",
        body: { userId: "charlie" },
      });

      expect(response.status).toBe(201);
      expect(addGroupMember).toHaveBeenCalledWith(
        { groupId: "group_1", organizationId: ORGANIZATION_ID, userId: "charlie" },
        // Who asked: the key's own grants bound who it may add to the group.
        OWNER_CALLER,
      );
    });

    /** @scenario DELETE /api/groups/:id/members/:userId removes a member */
    it("answers 200 and asks the application to remove that member", async () => {
      const removeGroupMember = vi.fn(async () => {});
      const send = mount({ removeGroupMember });

      const response = await send("/api/groups/group_1/members/alice-id", { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(removeGroupMember).toHaveBeenCalledWith({
        groupId: "group_1",
        organizationId: ORGANIZATION_ID,
        userId: "alice-id",
      });
    });
  });

  describe("when a group's role bindings are read and changed", () => {
    /** @scenario GET /api/groups/:id/bindings lists group role bindings */
    it("lists the binding with role, scopeType and scopeId", async () => {
      const send = mount({ listGroupBindings: async () => [binding] });

      const response = await send("/api/groups/group_1/bindings");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [binding] });
    });

    /** @scenario POST /api/groups/:id/bindings adds a role binding */
    it("answers 201 with the binding the application created", async () => {
      const addGroupGrant = vi.fn(async () => binding);
      const send = mount({ addGroupGrant });

      const response = await send("/api/groups/group_1/bindings", {
        method: "POST",
        body: { role: "MEMBER", scopeType: "TEAM", scopeId: "frontend-team-id" },
      });

      expect(response.status).toBe(201);
      expect(addGroupGrant).toHaveBeenCalledWith(
        {
          groupId: "group_1",
          organizationId: ORGANIZATION_ID,
          grant: { role: "MEMBER", scopeType: "TEAM", scopeId: "frontend-team-id" },
        },
        OWNER_CALLER,
      );
    });

    /** @scenario A service key grants through the organization doors, bounded by its own grants */
    it("hands a service key's grant on as the key itself, not as nobody", async () => {
      const addGroupGrant = vi.fn(async () => binding);
      const send = mount({ addGroupGrant }, { owner: null });

      const response = await send("/api/groups/group_1/bindings", {
        method: "POST",
        body: { role: "MEMBER", scopeType: "TEAM", scopeId: "frontend-team-id" },
      });

      expect(response.status).toBe(201);
      expect(addGroupGrant).toHaveBeenCalledWith(expect.anything(), {
        id: SYSTEM_ACTORS.managementApi,
        apiKeyId: KEY_ID,
      });
    });

    /** @scenario DELETE /api/groups/:id/bindings/:bindingId removes a binding */
    it("answers 200 and asks the application to remove that binding", async () => {
      const removeGroupGrant = vi.fn(async () => {});
      const send = mount({ removeGroupGrant });

      const response = await send("/api/groups/group_1/bindings/rb_123", { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(removeGroupGrant).toHaveBeenCalledWith(
        { groupId: "group_1", grantId: "rb_123", organizationId: ORGANIZATION_ID },
        OWNER_CALLER,
      );
    });

    /** @scenario DELETE /api/groups/:id/bindings/:bindingId returns 404 for nonexistent binding */
    it("answers 404 role_binding_not_found for a binding that does not exist", async () => {
      const send = mount({
        removeGroupGrant: async () => {
          throw new GroupBindingNotFoundError("nonexistent");
        },
      });

      const response = await send("/api/groups/group_1/bindings/nonexistent", { method: "DELETE" });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "role_binding_not_found" });
    });
  });
});
