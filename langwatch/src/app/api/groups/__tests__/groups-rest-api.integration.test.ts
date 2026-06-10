import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Team,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { app } from "../[[...route]]/app";

describe("Feature: Groups REST API", () => {
  const ns = `groups-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let patToken: string;
  let userId: string;
  let secondUserId: string;

  const authHeaders = () => ({
    Authorization: `Bearer ${patToken}`,
    "Content-Type": "application/json",
  });

  const api = {
    get: (path: string) =>
      app.request(path, { headers: authHeaders() }),
    post: (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    patch: (path: string, body: unknown) =>
      app.request(path, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    delete: (path: string) =>
      app.request(path, {
        method: "DELETE",
        headers: authHeaders(),
      }),
  };

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Groups Test Org", slug: `--test-org-${ns}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Groups Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: {
        name: "Groups Test User",
        email: `test-${ns}@example.com`,
      },
    });
    userId = user.id;

    const user2 = await prisma.user.create({
      data: {
        name: "Groups Second User",
        email: `test2-${ns}@example.com`,
      },
    });
    secondUserId = user2.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    await prisma.organizationUser.create({
      data: {
        userId: secondUserId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    const apiKeyService = ApiKeyService.create(prisma);
    const created = await apiKeyService.create({
      name: `groups-key-${nanoid(6)}`,
      userId,
      createdByUserId: userId,
      organizationId: testOrganization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
      ],
    });
    patToken = created.token;
  });

  afterAll(async () => {
    await prisma.groupMembership.deleteMany({
      where: { group: { organizationId: testOrganization.id } },
    }).catch(() => {});
    await prisma.roleBinding.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.group.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.apiKey.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.organizationUser.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.team.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [userId, secondUserId] } },
    }).catch(() => {});
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    }).catch(() => {});
  });

  describe("GET /api/groups", () => {
    /** @scenario GET /api/groups lists all groups */
    it("lists all groups for the organization", async () => {
      await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `List Test ${ns}`,
          slug: `list-test-${ns}`,
          organizationId: testOrganization.id,
        },
      });

      const res = await api.get("/api/groups");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.length).toBeGreaterThan(0);
    });

    /** @scenario GET /api/groups returns paginated results */
    it("returns paginated results", async () => {
      const res = await api.get("/api/groups?page=1&limit=10");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
    });

    /** @scenario GET /api/groups returns 401 without auth */
    it("returns 401 without auth", async () => {
      const res = await app.request("/api/groups");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/groups", () => {
    /** @scenario POST /api/groups creates a group */
    it("creates a group", async () => {
      const res = await api.post("/api/groups", {
        name: `New Group ${nanoid(6)}`,
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.slug).toBeDefined();
    });

    /** @scenario POST /api/groups creates a group with initial members and bindings */
    it("creates a group with members and bindings", async () => {
      const res = await api.post("/api/groups", {
        name: `Full Group ${nanoid(6)}`,
        memberIds: [secondUserId],
        bindings: [
          {
            role: "MEMBER",
            scopeType: "TEAM",
            scopeId: testTeam.id,
          },
        ],
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      const detail = await api.get(`/api/groups/${body.id}`);
      const detailBody = await detail.json();
      expect(detailBody.members.length).toBe(1);
      expect(detailBody.bindings.length).toBe(1);
    });

    /** @scenario POST /api/groups returns 422 for missing name */
    it("returns 422 for missing name", async () => {
      const res = await api.post("/api/groups", {});
      expect(res.status).toBe(422);
    });
  });

  describe("GET /api/groups/:id", () => {
    /** @scenario GET /api/groups/:id returns group with members and bindings */
    it("returns group with members and bindings", async () => {
      const group = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `Detail Test ${ns}`,
          slug: `detail-test-${ns}`,
          organizationId: testOrganization.id,
        },
      });
      await prisma.groupMembership.create({
        data: { groupId: group.id, userId: secondUserId },
      });

      const res = await api.get(`/api/groups/${group.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.members).toBeDefined();
      expect(body.members.length).toBe(1);
      expect(body.members[0].userId).toBe(secondUserId);
      expect(body.bindings).toBeDefined();
    });

    /** @scenario GET /api/groups/:id returns 404 for nonexistent group */
    it("returns 404 for nonexistent", async () => {
      const res = await api.get("/api/groups/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/groups/:id", () => {
    /** @scenario PATCH /api/groups/:id renames a group */
    it("renames a group", async () => {
      const group = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `Rename Test ${ns}`,
          slug: `rename-test-${ns}`,
          organizationId: testOrganization.id,
        },
      });

      const res = await api.patch(`/api/groups/${group.id}`, {
        name: "Renamed Group",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Renamed Group");
      expect(body.slug).toContain("renamed-group");
    });

    /** @scenario PATCH /api/groups/:id rejects rename of SCIM-managed group */
    it("rejects rename of SCIM-managed group", async () => {
      const group = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `SCIM Group ${ns}`,
          slug: `scim-group-${ns}`,
          organizationId: testOrganization.id,
          scimSource: "azure-ad",
        },
      });

      const res = await api.patch(`/api/groups/${group.id}`, {
        name: "New Name",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/groups/:id", () => {
    /** @scenario DELETE /api/groups/:id deletes a group */
    it("deletes a group", async () => {
      const group = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `Delete Test ${ns}`,
          slug: `delete-test-${ns}`,
          organizationId: testOrganization.id,
        },
      });

      const res = await api.delete(`/api/groups/${group.id}`);
      expect(res.status).toBe(200);

      const getRes = await api.get(`/api/groups/${group.id}`);
      expect(getRes.status).toBe(404);
    });

    /** @scenario DELETE /api/groups/:id returns 404 for nonexistent group */
    it("returns 404 for nonexistent", async () => {
      const res = await api.delete("/api/groups/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("Members", () => {
    let memberGroupId: string;

    beforeAll(async () => {
      const group = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `Member Test ${ns}`,
          slug: `member-test-${ns}`,
          organizationId: testOrganization.id,
        },
      });
      memberGroupId = group.id;
    });

    /** @scenario POST /api/groups/:id/members adds a member */
    it("adds a member", async () => {
      const res = await api.post(`/api/groups/${memberGroupId}/members`, {
        userId: secondUserId,
      });
      expect(res.status).toBe(201);
    });

    /** @scenario GET /api/groups/:id/members lists group members */
    it("lists group members", async () => {
      const res = await api.get(`/api/groups/${memberGroupId}/members`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].userId).toBeDefined();
      expect(body.data[0].name).toBeDefined();
    });

    /** @scenario DELETE /api/groups/:id/members/:userId removes a member */
    it("removes a member", async () => {
      const res = await api.delete(
        `/api/groups/${memberGroupId}/members/${secondUserId}`,
      );
      expect(res.status).toBe(200);

      const listRes = await api.get(`/api/groups/${memberGroupId}/members`);
      const body = await listRes.json();
      expect(body.data.find((m: { userId: string }) => m.userId === secondUserId)).toBeUndefined();
    });

    /** @scenario POST /api/groups/:id/members rejects adding to SCIM-managed group */
    it("rejects adding to SCIM-managed group", async () => {
      const scimGroup = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `SCIM Member ${ns}`,
          slug: `scim-member-${ns}`,
          organizationId: testOrganization.id,
          scimSource: "okta",
        },
      });

      const res = await api.post(`/api/groups/${scimGroup.id}/members`, {
        userId: secondUserId,
      });
      expect(res.status).toBe(400);
    });

    /** @scenario POST /api/groups/:id/members rejects non-org user */
    it("rejects non-org user", async () => {
      const outsider = await prisma.user.create({
        data: { name: "Outsider", email: `outsider-${ns}@example.com` },
      });

      const res = await api.post(`/api/groups/${memberGroupId}/members`, {
        userId: outsider.id,
      });
      expect(res.status).toBe(400);

      await prisma.user.delete({ where: { id: outsider.id } }).catch(() => {});
    });

    /** @scenario DELETE /api/groups/:id/members/:userId rejects removal from SCIM group */
    it("rejects removal from SCIM group", async () => {
      const scimGroup = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `SCIM Remove ${ns}`,
          slug: `scim-remove-${ns}`,
          organizationId: testOrganization.id,
          scimSource: "azure-ad",
        },
      });

      const res = await api.delete(
        `/api/groups/${scimGroup.id}/members/${userId}`,
      );
      expect(res.status).toBe(400);
    });
  });

  describe("Bindings", () => {
    let bindingGroupId: string;

    beforeAll(async () => {
      const group = await prisma.group.create({
        data: {
          id: generate(KSUID_RESOURCES.GROUP).toString(),
          name: `Binding Test ${ns}`,
          slug: `binding-test-${ns}`,
          organizationId: testOrganization.id,
        },
      });
      bindingGroupId = group.id;
    });

    /** @scenario POST /api/groups/:id/bindings adds a role binding */
    it("adds a role binding", async () => {
      const res = await api.post(`/api/groups/${bindingGroupId}/bindings`, {
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: testTeam.id,
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.role).toBe("MEMBER");
    });

    /** @scenario GET /api/groups/:id/bindings lists group role bindings */
    it("lists group bindings", async () => {
      const res = await api.get(`/api/groups/${bindingGroupId}/bindings`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].role).toBeDefined();
      expect(body.data[0].scopeType).toBeDefined();
    });

    /** @scenario DELETE /api/groups/:id/bindings/:bindingId removes a binding */
    it("removes a binding", async () => {
      const listRes = await api.get(`/api/groups/${bindingGroupId}/bindings`);
      const bindings = (await listRes.json()).data;
      const bindingId = bindings[0].id;

      const res = await api.delete(
        `/api/groups/${bindingGroupId}/bindings/${bindingId}`,
      );
      expect(res.status).toBe(200);
    });

    /** @scenario DELETE /api/groups/:id/bindings/:bindingId returns 404 for nonexistent binding */
    it("returns 404 for nonexistent binding", async () => {
      const res = await api.delete(
        `/api/groups/${bindingGroupId}/bindings/nonexistent`,
      );
      expect(res.status).toBe(404);
    });

    /** @scenario POST /api/groups/:id/bindings rejects cross-org scope */
    it("rejects cross-org scope", async () => {
      const otherOrg = await prisma.organization.create({
        data: { name: "Other Org", slug: `--test-other-org-${ns}` },
      });
      const otherTeam = await prisma.team.create({
        data: {
          name: "Other Team",
          slug: `--test-other-team-${ns}`,
          organizationId: otherOrg.id,
        },
      });

      const res = await api.post(`/api/groups/${bindingGroupId}/bindings`, {
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: otherTeam.id,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);

      await prisma.team.delete({ where: { id: otherTeam.id } }).catch(() => {});
      await prisma.organization.delete({ where: { id: otherOrg.id } }).catch(() => {});
    });
  });
});
