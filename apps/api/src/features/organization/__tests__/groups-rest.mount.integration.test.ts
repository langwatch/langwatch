/**
 * The `/api/groups` family as the process serves it: through the door
 * registry, behind the organization credential and the Enterprise plan gate
 * every route in it clears.
 * @see specs/groups/groups-rest-api.feature
 */
// @vitest-environment node
import {
  GroupBindingNotFoundError,
  GroupNotFoundError,
  GroupScopeNotInOrganizationError,
  ScimManagedGroupError,
  UserNotInOrganizationError,
  type OrganizationApi,
  type OrganizationGroupBinding,
  type OrganizationGroupDetails,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountGroupsRest } from "../groups-rest.mount.ts";

const ORGANIZATION_ID = "organization-1";
const API_KEY_ID = "api-key-credential";
const CALLER_USER_ID = "user-caller";
const GROUP_ID = "group-1";

const BINDING: OrganizationGroupBinding = {
  id: "binding-1",
  role: "ADMIN",
  customRoleId: null,
  customRoleName: null,
  scopeType: "ORGANIZATION",
  scopeId: ORGANIZATION_ID,
};

function groupDetails(): OrganizationGroupDetails {
  return {
    id: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    name: "Platform",
    slug: "platform",
    externalId: null,
    scimSource: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    members: [{ userId: CALLER_USER_ID, name: "Ada", email: "ada@example.test", image: null }],
    bindings: [BINDING],
  };
}

describe("given no organization credential on the groups family", () => {
  describe("when the groups are listed", () => {
    /** @scenario "GET /api/groups returns 401 without auth" */
    it("refuses before the request reaches the application", async () => {
      const listGroups = vi.fn();
      const world = mountGroups({ organizations: { listGroups }, credential: "refused" });

      const response = await world.send("/api/groups");

      expect(response.status).toBe(401);
      expect(listGroups).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization below the Enterprise plan", () => {
  describe("when any route in the family is called", () => {
    it("refuses with 402 before the application is reached", async () => {
      const listGroups = vi.fn();
      const world = mountGroups({ organizations: { listGroups }, planType: "FREE" });

      const response = await world.send("/api/groups");

      expect(response.status).toBe(402);
      expect(listGroups).not.toHaveBeenCalled();
    });
  });
});

describe("given an Enterprise organization on the groups family", () => {
  describe("when the groups are listed", () => {
    /** @scenario "GET /api/groups lists all groups" */
    it("answers each group with its member count and bindings, and no avatars", async () => {
      const world = mountGroups({
        organizations: {
          listGroups: vi.fn(async () => ({
            data: [{ ...groupDetails(), memberCount: 1 }],
            pagination: { page: 1, limit: 50, total: 1 },
          })),
        },
      });

      const response = await world.send("/api/groups");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [
          {
            id: GROUP_ID,
            name: "Platform",
            slug: "platform",
            externalId: null,
            scimSource: null,
            memberCount: 1,
            bindings: [BINDING],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, limit: 50, total: 1 },
      });
    });

    /** @scenario "GET /api/groups returns paginated results" */
    it("passes the requested page and limit through", async () => {
      const listGroups = vi.fn(async () => ({
        data: [],
        pagination: { page: 2, limit: 1, total: 0 },
      }));
      const world = mountGroups({ organizations: { listGroups } });

      await world.send("/api/groups?page=2&limit=1");

      expect(listGroups).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        page: 2,
        limit: 1,
      });
    });
  });

  describe("when a group is created", () => {
    /** @scenario "POST /api/groups creates a group" */
    it("answers 201 and attributes the write to the member the credential acts as", async () => {
      const createGroup = vi.fn(async () => groupDetails());
      const world = mountGroups({ organizations: { createGroup } });

      const response = await world.send("/api/groups", {
        method: "POST",
        body: { name: "Platform" },
      });

      expect(response.status).toBe(201);
      expect(createGroup).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, name: "Platform" },
        { id: CALLER_USER_ID },
      );
    });

    /** @scenario "POST /api/groups creates a group with initial members and bindings" */
    it("passes the members and bindings the request asked for", async () => {
      const createGroup = vi.fn(async () => groupDetails());
      const world = mountGroups({ organizations: { createGroup } });

      const response = await world.send("/api/groups", {
        method: "POST",
        body: {
          name: "Platform",
          memberIds: [CALLER_USER_ID],
          bindings: [{ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
        },
      });

      expect(response.status).toBe(201);
      expect(createGroup).toHaveBeenCalledWith(
        {
          organizationId: ORGANIZATION_ID,
          name: "Platform",
          memberIds: [CALLER_USER_ID],
          bindings: [{ role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" }],
        },
        { id: CALLER_USER_ID },
      );
    });

    /** @scenario "POST /api/groups returns 422 for missing name" */
    it("refuses a body with no name and writes nothing", async () => {
      const createGroup = vi.fn();
      const world = mountGroups({ organizations: { createGroup } });

      const response = await world.send("/api/groups", { method: "POST", body: {} });

      expect(response.status).toBe(422);
      expect(createGroup).not.toHaveBeenCalled();
    });
  });

  describe("when one group is read", () => {
    /** @scenario "GET /api/groups/:id returns group with members and bindings" */
    it("answers with its members and its bindings, without their avatars", async () => {
      const world = mountGroups({ organizations: { getGroup: vi.fn(async () => groupDetails()) } });

      const response = await world.send(`/api/groups/${GROUP_ID}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: GROUP_ID,
        name: "Platform",
        slug: "platform",
        externalId: null,
        scimSource: null,
        members: [{ userId: CALLER_USER_ID, name: "Ada", email: "ada@example.test" }],
        bindings: [BINDING],
      });
    });

    /** @scenario "GET /api/groups/:id returns 404 for nonexistent group" */
    it("reports an unknown id as not found", async () => {
      const world = mountGroups({
        organizations: {
          getGroup: vi.fn(async (): Promise<OrganizationGroupDetails> => {
            throw new GroupNotFoundError("nonexistent");
          }),
        },
      });

      const response = await world.send("/api/groups/nonexistent");

      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("group_not_found");
    });
  });

  describe("when a group is renamed", () => {
    /** @scenario "PATCH /api/groups/:id renames a group" */
    it("answers with the new name and slug", async () => {
      const renameGroup = vi.fn(async () => ({ ...groupDetails(), name: "Renamed" }));
      const world = mountGroups({ organizations: { renameGroup } });

      const response = await world.send(`/api/groups/${GROUP_ID}`, {
        method: "PATCH",
        body: { name: "Renamed" },
      });

      expect(response.status).toBe(200);
      expect(renameGroup).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        groupId: GROUP_ID,
        name: "Renamed",
      });
      await expect(response.json()).resolves.toEqual({
        id: GROUP_ID,
        name: "Renamed",
        slug: "platform",
      });
    });

    /** @scenario "PATCH /api/groups/:id rejects rename of SCIM-managed group" */
    it("reports a directory-managed group as a conflict", async () => {
      const world = mountGroups({
        organizations: {
          renameGroup: vi.fn(async () => {
            throw new ScimManagedGroupError(GROUP_ID);
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}`, {
        method: "PATCH",
        body: { name: "Renamed" },
      });

      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("scim_managed_group");
    });
  });

  describe("when a group is deleted", () => {
    /** @scenario "DELETE /api/groups/:id deletes a group" */
    it("names no SCIM override, so a directory-managed group is still refused", async () => {
      const deleteGroup = vi.fn(async () => {});
      const world = mountGroups({ organizations: { deleteGroup } });

      const response = await world.send(`/api/groups/${GROUP_ID}`, { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(deleteGroup).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, groupId: GROUP_ID },
        { id: CALLER_USER_ID },
      );
    });

    /** @scenario "DELETE /api/groups/:id rejects deleting a SCIM-managed group" */
    it("reports a directory-managed group as a conflict", async () => {
      const world = mountGroups({
        organizations: {
          deleteGroup: vi.fn(async () => {
            throw new ScimManagedGroupError(GROUP_ID);
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}`, { method: "DELETE" });

      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("scim_managed_group");
    });

    /** @scenario "DELETE /api/groups/:id returns 404 for nonexistent group" */
    it("reports an unknown id as not found", async () => {
      const world = mountGroups({
        organizations: {
          deleteGroup: vi.fn(async () => {
            throw new GroupNotFoundError("nonexistent");
          }),
        },
      });

      const response = await world.send("/api/groups/nonexistent", { method: "DELETE" });

      expect(response.status).toBe(404);
    });
  });

  describe("when a group's membership is read or changed", () => {
    /** @scenario "GET /api/groups/:id/members lists group members" */
    it("lists the members without their avatars", async () => {
      const world = mountGroups({ organizations: { getGroup: vi.fn(async () => groupDetails()) } });

      const response = await world.send(`/api/groups/${GROUP_ID}/members`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [{ userId: CALLER_USER_ID, name: "Ada", email: "ada@example.test" }],
      });
    });

    /** @scenario "POST /api/groups/:id/members adds a member" */
    it("answers 201 and names the group the path addressed", async () => {
      const addGroupMember = vi.fn(async () => {});
      const world = mountGroups({ organizations: { addGroupMember } });

      const response = await world.send(`/api/groups/${GROUP_ID}/members`, {
        method: "POST",
        body: { userId: "user-added" },
      });

      expect(response.status).toBe(201);
      expect(addGroupMember).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        groupId: GROUP_ID,
        userId: "user-added",
      });
    });

    /** @scenario "POST /api/groups/:id/members rejects adding to SCIM-managed group" */
    it("reports adding to a directory-managed group as a conflict", async () => {
      const world = mountGroups({
        organizations: {
          addGroupMember: vi.fn(async () => {
            throw new ScimManagedGroupError(GROUP_ID);
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}/members`, {
        method: "POST",
        body: { userId: "user-added" },
      });

      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("scim_managed_group");
    });

    /** @scenario "POST /api/groups/:id/members rejects non-org user" */
    it("reports somebody outside the organization as an unprocessable request", async () => {
      const world = mountGroups({
        organizations: {
          addGroupMember: vi.fn(async () => {
            throw new UserNotInOrganizationError("outsider");
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}/members`, {
        method: "POST",
        body: { userId: "outsider" },
      });

      expect(response.status).toBe(422);
    });

    /** @scenario "DELETE /api/groups/:id/members/:userId removes a member" */
    it("names both the group and the member the path addressed", async () => {
      const removeGroupMember = vi.fn(async () => {});
      const world = mountGroups({ organizations: { removeGroupMember } });

      const response = await world.send(`/api/groups/${GROUP_ID}/members/user-removed`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(removeGroupMember).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        groupId: GROUP_ID,
        userId: "user-removed",
      });
    });

    /** @scenario "DELETE /api/groups/:id/members/:userId rejects removal from SCIM group" */
    it("reports removing from a directory-managed group as a conflict", async () => {
      const world = mountGroups({
        organizations: {
          removeGroupMember: vi.fn(async () => {
            throw new ScimManagedGroupError(GROUP_ID);
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}/members/user-removed`, {
        method: "DELETE",
      });

      expect(response.status).toBe(409);
    });
  });

  describe("when a group's role bindings are read or changed", () => {
    /** @scenario "GET /api/groups/:id/bindings lists group role bindings" */
    it("lists the bindings the application reports", async () => {
      const world = mountGroups({
        organizations: { listGroupBindings: vi.fn(async () => [BINDING]) },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}/bindings`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [BINDING] });
    });

    /** @scenario "POST /api/groups/:id/bindings adds a role binding" */
    it("hands the application the binding without the group id the path named", async () => {
      const addGroupBinding = vi.fn(async () => BINDING);
      const world = mountGroups({ organizations: { addGroupBinding } });

      const response = await world.send(`/api/groups/${GROUP_ID}/bindings`, {
        method: "POST",
        body: { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
      });

      expect(response.status).toBe(201);
      expect(addGroupBinding).toHaveBeenCalledWith(
        {
          organizationId: ORGANIZATION_ID,
          groupId: GROUP_ID,
          binding: { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
        },
        { id: CALLER_USER_ID },
      );
    });

    /** @scenario "POST /api/groups/:id/bindings rejects cross-org scope" */
    it("refuses a binding whose scope belongs to another organization", async () => {
      const world = mountGroups({
        organizations: {
          addGroupBinding: vi.fn(async () => {
            throw new GroupScopeNotInOrganizationError("TEAM");
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}/bindings`, {
        method: "POST",
        body: { role: "MEMBER", scopeType: "TEAM", scopeId: "team-in-another-org" },
      });

      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("scope_not_in_organization");
    });

    /** @scenario "DELETE /api/groups/:id/bindings/:bindingId removes a binding" */
    it("names the group and the binding the path addressed", async () => {
      const removeGroupBinding = vi.fn(async () => {});
      const world = mountGroups({ organizations: { removeGroupBinding } });

      const response = await world.send(`/api/groups/${GROUP_ID}/bindings/binding-1`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(removeGroupBinding).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, groupId: GROUP_ID, bindingId: "binding-1" },
        { id: CALLER_USER_ID },
      );
    });

    /** @scenario "DELETE /api/groups/:id/bindings/:bindingId returns 404 for nonexistent binding" */
    it("reports a binding this group does not hold as not found", async () => {
      const world = mountGroups({
        organizations: {
          removeGroupBinding: vi.fn(async () => {
            throw new GroupBindingNotFoundError("nonexistent");
          }),
        },
      });

      const response = await world.send(`/api/groups/${GROUP_ID}/bindings/nonexistent`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("role_binding_not_found");
    });
  });
});

describe("given a service credential on the groups family", () => {
  describe("when a group is created", () => {
    it("attributes the write to the management API, because a service key acts as nobody", async () => {
      const createGroup = vi.fn(async () => groupDetails());
      const world = mountGroups({ organizations: { createGroup }, callerUserId: null });

      const response = await world.send("/api/groups", {
        method: "POST",
        body: { name: "Platform" },
      });

      expect(response.status).toBe(201);
      expect(createGroup).toHaveBeenCalledWith(expect.anything(), {
        id: "system:management-api",
      });
    });
  });
});

// ---------------------------------------------------------------------------

/** The stable error code a refusal names, whichever envelope it arrives in. */
async function codeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: string | { code?: string } };

  return typeof body.error === "string" ? body.error : body.error?.code;
}

/** The family as the process serves it, over this process's own REST runtime. */
function mountGroups(options: {
  organizations: Partial<OrganizationApi>;
  planType?: string;
  callerUserId?: string | null;
  credential?: "refused";
}) {
  const organizations = createApiFixture<OrganizationApi>(options.organizations, "OrganizationApi");
  const callerUserId = options.callerUserId === undefined ? CALLER_USER_ID : options.callerUserId;

  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This suite composed no project credential door.");
    },
    organizationCredential: () =>
      Promise.resolve(
        options.credential === "refused"
          ? { ok: false as const, status: 401 as const, body: { error: "unauthorized" } }
          : {
              ok: true as const,
              resolved: {
                type: "apiKey-org" as const,
                apiKeyId: API_KEY_ID,
                userId: callerUserId,
                organizationId: ORGANIZATION_ID,
              },
              markUsed: () => {},
            },
      ),
    organizationIdentity: () => {
      throw new Error("Every route in this family asks a permission of the credential.");
    },
    routeAuthorization: () => {
      throw new Error("This family authorizes no route-scoped permission.");
    },
    errors: ApiRestObservabilityComposition.create().legacyErrorHandler,
  });

  const mounted = mountGroupsRest(runtime, {
    organizations: () => organizations,
    plans: () =>
      ({
        getActivePlan: async () => ({ type: options.planType ?? "ENTERPRISE" }),
      }) as never,
  });

  const hono = new Hono().route("/", mounted);

  return {
    send: (path: string, init: { method?: string; body?: unknown } = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: { "Content-Type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      ),
  };
}
