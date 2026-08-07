/**
 * @vitest-environment node
 *
 * @see specs/api-keys/api-keys-management-rest-api.feature
 *
 * The read and edit half of the API keys REST family: fetching one key with
 * its bindings, and editing a key's name, bindings and permission mode. Both
 * report a key the caller may not touch exactly as they report one that does
 * not exist, and neither can widen a key past the access of the member it
 * belongs to.
 */
import { generate } from "@langwatch/ksuid";
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../[[...route]]/app";

describe("Feature: API keys management REST API", () => {
  const ns = `api-keys-mgmt-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let adminUserId: string;
  let managerUserId: string;
  let memberUserId: string;
  let adminToken: string;
  let managerToken: string;

  const apiKeyService = ApiKeyService.create(prisma);

  const headersFor = (token: string) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  const get = (token: string, id: string) =>
    app.request(`/api/api-keys/${id}`, { headers: headersFor(token) });

  const patch = (token: string, id: string, body: unknown) =>
    app.request(`/api/api-keys/${id}`, {
      method: "PATCH",
      headers: headersFor(token),
      body: JSON.stringify(body),
    });

  const post = (token: string, body: unknown) =>
    app.request("/api/api-keys", {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify(body),
    });

  type Binding = {
    role: "ADMIN" | "MEMBER" | "VIEWER";
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  };

  const createKey = async ({
    userId,
    name,
    description,
    bindings,
  }: {
    userId: string;
    name: string;
    description?: string;
    bindings: Binding[];
  }) =>
    apiKeyService.create({
      name,
      description,
      userId,
      createdByUserId: userId,
      organizationId: testOrganization.id,
      permissionMode: "all",
      bindings,
    });

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Api Keys Management Org", slug: `--test-org-${ns}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Api Keys Management Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        name: "Api Keys Management Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-project-key-${ns}`,
        teamId: testTeam.id,
        language: "en",
        framework: "test",
      },
    });

    const adminUser = await prisma.user.create({
      data: { name: "Admin User", email: `admin-${ns}@example.com` },
    });
    adminUserId = adminUser.id;
    const managerUser = await prisma.user.create({
      data: { name: "Manager User", email: `manager-${ns}@example.com` },
    });
    managerUserId = managerUser.id;
    const memberUser = await prisma.user.create({
      data: { name: "Member User", email: `member-${ns}@example.com` },
    });
    memberUserId = memberUser.id;

    await prisma.organizationUser.createMany({
      data: [
        {
          userId: adminUserId,
          organizationId: testOrganization.id,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: managerUserId,
          organizationId: testOrganization.id,
          role: OrganizationUserRole.MEMBER,
        },
        {
          userId: memberUserId,
          organizationId: testOrganization.id,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });

    // The manager holds organization:manage (enough to reach every write on
    // this family) plus project:view, and nothing else. That is exactly the
    // caller the widening pin is about: allowed to edit keys, not allowed to
    // hand one more access than they have themselves.
    const manageRole = await prisma.customRole.create({
      data: {
        name: `manage-and-view-${ns}`,
        organizationId: testOrganization.id,
        permissions: ["organization:manage", "project:view"],
        kind: "custom",
      },
    });

    await prisma.roleBinding.createMany({
      data: [
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: testOrganization.id,
          userId: adminUserId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: testOrganization.id,
          userId: managerUserId,
          role: TeamUserRole.CUSTOM,
          customRoleId: manageRole.id,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: testOrganization.id,
          userId: memberUserId,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: testOrganization.id,
          userId: memberUserId,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: testTeam.id,
        },
      ],
    });

    adminToken = (
      await apiKeyService.create({
        name: `admin-key-${ns}`,
        userId: adminUserId,
        createdByUserId: adminUserId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: "ADMIN",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    managerToken = (
      await apiKeyService.create({
        name: `manager-key-${ns}`,
        userId: managerUserId,
        createdByUserId: managerUserId,
        organizationId: testOrganization.id,
        permissionMode: "restricted",
        permissions: ["organization:manage", "project:view"],
        bindings: [
          {
            role: "CUSTOM",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId: testOrganization.id }],
      ["apiKey", { organizationId: testOrganization.id }],
      ["customRole", { organizationId: testOrganization.id }],
      ["project", { teamId: testTeam.id }],
      ["team", { organizationId: testOrganization.id }],
      ["organizationUser", { organizationId: testOrganization.id }],
      ["user", { id: { in: [adminUserId, managerUserId, memberUserId] } }],
      ["organization", { id: testOrganization.id }],
    ]);
  });

  describe("given a key bound to a team", () => {
    describe("when its owner fetches it by id", () => {
      /** @scenario Fetching an API key returns its bindings */
      it("returns the name, description, permission mode and bindings", async () => {
        const { apiKey } = await createKey({
          userId: adminUserId,
          name: `fetch-target-${ns}`,
          description: "Reads the pipeline dashboards",
          bindings: [
            { role: "MEMBER", scopeType: "TEAM", scopeId: testTeam.id },
          ],
        });

        const res = await get(adminToken, apiKey.id);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toMatchObject({
          id: apiKey.id,
          name: `fetch-target-${ns}`,
          description: "Reads the pipeline dashboards",
          keyType: "personal",
          assignedToUserId: adminUserId,
          permissionMode: "all",
          permissions: [],
        });
        expect(body.bindings).toEqual([
          { role: "MEMBER", scopeType: "TEAM", scopeId: testTeam.id },
        ]);
        expect(body.roleBindings).toEqual([
          {
            id: expect.any(String),
            role: "MEMBER",
            scopeType: "TEAM",
            scopeId: testTeam.id,
          },
        ]);
      });

      it("never returns the secret or its lookup id", async () => {
        const { apiKey } = await createKey({
          userId: adminUserId,
          name: `fetch-secrecy-${ns}`,
          bindings: [
            { role: "MEMBER", scopeType: "TEAM", scopeId: testTeam.id },
          ],
        });

        const res = await get(adminToken, apiKey.id);
        const body = await res.json();

        expect(body).not.toHaveProperty("token");
        expect(body).not.toHaveProperty("lookupId");
        expect(body).not.toHaveProperty("hashedSecret");
      });
    });

    describe("when the id names no key the caller can reach", () => {
      /** @scenario Fetching an unknown API key returns not found */
      it("reports an unknown id as not found", async () => {
        const res = await get(adminToken, `api-key_missing-${ns}`);

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("api_key_not_found");
      });

      it("reports another member's key as not found for a non-admin", async () => {
        const { apiKey } = await createKey({
          userId: memberUserId,
          name: `member-owned-${ns}`,
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        const res = await get(managerToken, apiKey.id);

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("api_key_not_found");
      });

      it("returns a service key to a member, matching what the listing shows them", async () => {
        const { apiKey } = await apiKeyService.create({
          name: `service-key-${ns}`,
          userId: null,
          createdByUserId: adminUserId,
          organizationId: testOrganization.id,
          permissionMode: "all",
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        const listed = await (
          await app.request("/api/api-keys", {
            headers: headersFor(managerToken),
          })
        ).json();
        expect(
          listed.data.some((key: { id: string }) => key.id === apiKey.id),
        ).toBe(true);

        const res = await get(managerToken, apiKey.id);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.keyType).toBe("service");
        expect(body.assignedToUserId).toBeNull();
      });

      it("returns another member's key to an organization admin", async () => {
        const { apiKey } = await createKey({
          userId: memberUserId,
          name: `member-owned-for-admin-${ns}`,
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        const res = await get(adminToken, apiKey.id);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.assignedToUserId).toBe(memberUserId);
      });
    });

    describe("when only the name is updated", () => {
      /** @scenario Renaming an API key preserves its bindings */
      it("renames the key and leaves the team binding in place", async () => {
        const { apiKey } = await createKey({
          userId: adminUserId,
          name: `rename-before-${ns}`,
          bindings: [
            { role: "MEMBER", scopeType: "TEAM", scopeId: testTeam.id },
          ],
        });

        const res = await patch(adminToken, apiKey.id, {
          name: `rename-after-${ns}`,
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe(`rename-after-${ns}`);
        expect(body.bindings).toEqual([
          { role: "MEMBER", scopeType: "TEAM", scopeId: testTeam.id },
        ]);

        const readBack = await (await get(adminToken, apiKey.id)).json();
        expect(readBack.name).toBe(`rename-after-${ns}`);
        expect(readBack.bindings).toEqual(body.bindings);
      });
    });
  });

  describe("given a key bound organization-wide", () => {
    describe("when its bindings are replaced with a narrower set", () => {
      /** @scenario Replacing bindings with a tighter set takes effect */
      it("keeps only the project binding that was sent", async () => {
        const { apiKey } = await createKey({
          userId: adminUserId,
          name: `tighten-${ns}`,
          bindings: [
            {
              role: "ADMIN",
              scopeType: "ORGANIZATION",
              scopeId: testOrganization.id,
            },
          ],
        });

        const res = await patch(adminToken, apiKey.id, {
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        expect(res.status).toBe(200);

        const readBack = await (await get(adminToken, apiKey.id)).json();
        expect(readBack.bindings).toEqual([
          { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
        ]);

        const stored = await prisma.roleBinding.findMany({
          where: {
            organizationId: testOrganization.id,
            apiKeyId: apiKey.id,
          },
          select: { role: true, scopeType: true, scopeId: true },
        });
        expect(stored).toEqual([
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: testProject.id,
          },
        ]);
      });
    });

    describe("when restricted mode is requested without permissions", () => {
      /** @scenario Setting restricted mode requires explicit permissions */
      it("refuses the update and leaves the permission mode alone", async () => {
        const { apiKey } = await createKey({
          userId: adminUserId,
          name: `restricted-without-permissions-${ns}`,
          bindings: [
            {
              role: "ADMIN",
              scopeType: "ORGANIZATION",
              scopeId: testOrganization.id,
            },
          ],
        });

        const res = await patch(adminToken, apiKey.id, {
          permissionMode: "restricted",
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("validation_error");

        const readBack = await (await get(adminToken, apiKey.id)).json();
        expect(readBack.permissionMode).toBe("all");
      });
    });
  });

  describe("given a key belonging to a caller who is not an organization admin", () => {
    describe("when its bindings are widened past that caller's own access", () => {
      /** @scenario Widening a key beyond the caller's own access is refused */
      it("refuses the update and keeps the viewer binding", async () => {
        const { apiKey } = await createKey({
          userId: managerUserId,
          name: `widen-${ns}`,
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        const res = await patch(managerToken, apiKey.id, {
          bindings: [
            { role: "ADMIN", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("api_key_scope_violation");

        const readBack = await (await get(managerToken, apiKey.id)).json();
        expect(readBack.bindings).toEqual([
          { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
        ]);
      });
    });

    describe("when it edits a key it does not own", () => {
      it("reports the key as not found rather than forbidden", async () => {
        const { apiKey } = await createKey({
          userId: memberUserId,
          name: `foreign-edit-${ns}`,
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        const res = await patch(managerToken, apiKey.id, {
          name: `foreign-edit-renamed-${ns}`,
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("api_key_not_found");

        const untouched = await prisma.apiKey.findUnique({
          where: { id: apiKey.id },
          select: { name: true },
        });
        expect(untouched?.name).toBe(`foreign-edit-${ns}`);
      });
    });
  });

  describe("given a key requested on behalf of another member", () => {
    describe("when the caller is not an organization admin", () => {
      it("refuses the mint", async () => {
        const name = `assigned-by-manager-${ns}`;
        const res = await post(managerToken, {
          name,
          assignedToUserId: memberUserId,
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        expect(res.status).toBe(403);

        const minted = await prisma.apiKey.findFirst({
          where: { organizationId: testOrganization.id, name },
        });
        expect(minted).toBeNull();
      });
    });

    describe("when the caller is an organization admin", () => {
      it("mints the key against the assigned member's own ceiling", async () => {
        const res = await post(adminToken, {
          name: `assigned-by-admin-${ns}`,
          assignedToUserId: memberUserId,
          bindings: [
            { role: "VIEWER", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        expect(res.status).toBe(201);
        const body = await res.json();

        const readBack = await (await get(adminToken, body.apiKey.id)).json();
        expect(readBack.assignedToUserId).toBe(memberUserId);
        expect(readBack.createdByUserId).toBe(adminUserId);
      });

      it("refuses bindings the assigned member could not hold themselves", async () => {
        const name = `assigned-beyond-ceiling-${ns}`;
        const res = await post(adminToken, {
          name,
          assignedToUserId: memberUserId,
          bindings: [
            { role: "ADMIN", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        expect(res.status).toBe(403);

        const minted = await prisma.apiKey.findFirst({
          where: { organizationId: testOrganization.id, name },
        });
        expect(minted).toBeNull();
      });
    });
  });

  describe("given a key created with an explicit permission set", () => {
    describe("when it is fetched by id", () => {
      it("returns the permissions the restricted mode grants", async () => {
        const { apiKey } = await apiKeyService.create({
          name: `restricted-key-${ns}`,
          userId: adminUserId,
          createdByUserId: adminUserId,
          organizationId: testOrganization.id,
          permissionMode: "restricted",
          permissions: ["traces:view", "analytics:view"],
          bindings: [
            { role: "CUSTOM", scopeType: "PROJECT", scopeId: testProject.id },
          ],
        });

        const readBack = await (await get(adminToken, apiKey.id)).json();

        expect(readBack.permissionMode).toBe("restricted");
        expect(readBack.permissions).toEqual(["analytics:view", "traces:view"]);
        expect(readBack.bindings).toEqual([
          { role: "CUSTOM", scopeType: "PROJECT", scopeId: testProject.id },
        ]);
      });
    });
  });
});
