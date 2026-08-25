/**
 * @vitest-environment node
 *
 * @see specs/api-keys/api-keys-management-rest-api.feature
 *
 * Security pins for the API keys REST family:
 *   - minting a service key requires real organization adminness, not just
 *     the organization:manage permission (which a custom role can carry);
 *   - revoking another user's key resolves the caller's real adminness
 *     instead of assuming it;
 *   - the org-wide listing is admin territory: a view-only service
 *     credential gets refused, not handed every key in the organization;
 *   - no key can be bound into a personal workspace the credential does
 *     not own (issue #6338, api-key half).
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../[[...route]]/app";

wireDefaultTestApp();

describe("Feature: API keys management REST API", () => {
  const ns = `api-keys-sec-${nanoid(8)}`;

  let testOrganization: Organization;
  let personalTeam: Team;
  let personalProject: Project;
  let adminUserId: string;
  let managerUserId: string;
  let ownerUserId: string;
  let adminToken: string;
  let managerToken: string;
  let serviceViewerToken: string;
  let serviceManagerToken: string;
  let serviceAdminToken: string;

  const apiKeyService = getApp().apiKeys;

  const headersFor = (token: string) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  const post = (token: string, body: unknown) =>
    app.request("/api/api-keys", {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify(body),
    });

  const list = (token: string) =>
    app.request("/api/api-keys", { headers: headersFor(token) });

  const del = (token: string, id: string) =>
    app.request(`/api/api-keys/${id}`, {
      method: "DELETE",
      headers: headersFor(token),
    });

  const createOwnedKey = async ({
    userId,
    name,
  }: {
    userId: string;
    name: string;
  }) =>
    apiKeyService.create({
      name,
      userId,
      createdByUserId: userId,
      organizationId: testOrganization.id,
      permissionMode: "all",
      bindings: [
        {
          role: "MEMBER",
          scopeType: "ORGANIZATION",
          scopeId: testOrganization.id,
        },
      ],
    });

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Api Keys Security Org", slug: `--test-org-${ns}` },
    });

    const adminUser = await prisma.user.create({
      data: { name: "Admin User", email: `admin-${ns}@example.com` },
    });
    adminUserId = adminUser.id;
    const managerUser = await prisma.user.create({
      data: { name: "Manager User", email: `manager-${ns}@example.com` },
    });
    managerUserId = managerUser.id;
    const ownerUser = await prisma.user.create({
      data: { name: "Workspace Owner", email: `owner-${ns}@example.com` },
    });
    ownerUserId = ownerUser.id;

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
          userId: ownerUserId,
          organizationId: testOrganization.id,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });

    // The admin holds a real org-scope ADMIN binding; the manager holds
    // organization:manage only through a CUSTOM role, which is exactly the
    // caller the escalation pin is about.
    const manageRole = await prisma.customRole.create({
      data: {
        name: `manage-only-${ns}`,
        organizationId: testOrganization.id,
        permissions: ["organization:manage"],
        kind: "custom",
      },
    });

    personalTeam = await prisma.team.create({
      data: {
        name: "Workspace Owner's Workspace",
        slug: `--test-personal-team-${ns}`,
        organizationId: testOrganization.id,
        isPersonal: true,
        ownerUserId,
      },
    });
    personalProject = await prisma.project.create({
      data: {
        name: "Workspace Owner's Project",
        slug: `--test-personal-project-${ns}`,
        apiKey: `--test-project-key-${ns}`,
        teamId: personalTeam.id,
        language: "en",
        framework: "test",
        isPersonal: true,
        ownerUserId,
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
          userId: ownerUserId,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
        // The canonical owner binding a personal workspace is provisioned
        // with; it is what puts the owner's own ceiling above the workspace.
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: testOrganization.id,
          userId: ownerUserId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: personalTeam.id,
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
        permissions: ["organization:manage"],
        bindings: [
          {
            role: "CUSTOM",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    serviceViewerToken = (
      await apiKeyService.create({
        name: `service-viewer-${ns}`,
        userId: null,
        createdByUserId: adminUserId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: "VIEWER",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    serviceManagerToken = (
      await apiKeyService.create({
        name: `service-manager-${ns}`,
        userId: null,
        createdByUserId: adminUserId,
        organizationId: testOrganization.id,
        permissionMode: "restricted",
        permissions: ["organization:manage"],
        bindings: [
          {
            role: "CUSTOM",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    serviceAdminToken = (
      await apiKeyService.create({
        name: `service-admin-${ns}`,
        userId: null,
        createdByUserId: adminUserId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [],
      })
    ).token;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId: testOrganization?.id }],
      ["apiKey", { organizationId: testOrganization?.id }],
      ["customRole", { organizationId: testOrganization?.id }],
      ["project", { teamId: personalTeam?.id }],
      ["team", { organizationId: testOrganization?.id }],
      ["organizationUser", { organizationId: testOrganization?.id }],
      ["user", { id: { in: [adminUserId, managerUserId, ownerUserId] } }],
      ["organization", { id: testOrganization?.id }],
    ]);
  });

  describe("when a service key is minted", () => {
    /** @scenario A manage-permission holder cannot mint an unbound service key */
    it("refuses a manage-holder who is not an organization admin", async () => {
      const name = `svc-escalation-${ns}`;
      const res = await post(managerToken, { keyType: "service", name });

      expect(res.status).toBe(403);

      const minted = await prisma.apiKey.findFirst({
        where: { organizationId: testOrganization.id, name },
      });
      expect(minted).toBeNull();
    });

    it("refuses a service credential holding manage without an admin binding", async () => {
      const name = `svc-from-service-${ns}`;
      const res = await post(serviceManagerToken, { keyType: "service", name });

      expect(res.status).toBe(403);

      const minted = await prisma.apiKey.findFirst({
        where: { organizationId: testOrganization.id, name },
      });
      expect(minted).toBeNull();
    });

    it("lets an organization admin mint a service key", async () => {
      const name = `svc-by-admin-${ns}`;
      const res = await post(adminToken, { keyType: "service", name });

      expect(res.status).toBe(201);
      const body = await res.json();
      const bindings = await prisma.roleBinding.findMany({
        where: {
          organizationId: testOrganization.id,
          apiKeyId: body.apiKey.id,
        },
      });
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toMatchObject({
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      });
    });

    it("lets an org-wide admin service credential mint a service key", async () => {
      const res = await post(serviceAdminToken, {
        keyType: "service",
        name: `svc-by-service-admin-${ns}`,
      });
      expect(res.status).toBe(201);
    });
  });

  describe("when a key is revoked", () => {
    /** @scenario Deleting another user's key requires organization admin rights */
    it("refuses a manage-holder who does not own the key and is not an admin", async () => {
      const { apiKey } = await createOwnedKey({
        userId: ownerUserId,
        name: `owned-for-manager-delete-${ns}`,
      });

      const res = await del(managerToken, apiKey.id);
      expect(res.status).toBe(403);

      const untouched = await prisma.apiKey.findUnique({
        where: { id: apiKey.id },
        select: { revokedAt: true },
      });
      expect(untouched?.revokedAt).toBeNull();
    });

    it("lets an organization admin revoke another user's key", async () => {
      const { apiKey } = await createOwnedKey({
        userId: ownerUserId,
        name: `owned-for-admin-delete-${ns}`,
      });

      const res = await del(adminToken, apiKey.id);
      expect(res.status).toBe(200);

      const revoked = await prisma.apiKey.findUnique({
        where: { id: apiKey.id },
        select: { revokedAt: true },
      });
      expect(revoked?.revokedAt).not.toBeNull();
    });

    it("lets the owner revoke their own key", async () => {
      const { apiKey } = await apiKeyService.create({
        name: `manager-own-second-${ns}`,
        userId: managerUserId,
        createdByUserId: managerUserId,
        organizationId: testOrganization.id,
        permissionMode: "restricted",
        permissions: ["organization:manage"],
        bindings: [
          {
            role: "CUSTOM",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      });

      const res = await del(managerToken, apiKey.id);
      expect(res.status).toBe(200);
    });
  });

  describe("when a service credential lists keys", () => {
    /** @scenario A view-only service credential cannot list every key in the organization */
    it("refuses the org-wide listing for a view-only service credential", async () => {
      const res = await list(serviceViewerToken);
      expect(res.status).toBe(403);
    });

    it("returns the org-wide listing for an admin service credential", async () => {
      const res = await list(serviceAdminToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("still lists their own keys for a user credential", async () => {
      const res = await list(managerToken);
      expect(res.status).toBe(200);
    });
  });

  // Regression tests for issue #6338 (api-key half): role bindings written by
  // the API key service must not reach into a personal workspace the
  // credential does not own.
  describe("when a binding names a personal workspace", () => {
    /** @scenario An API key cannot be bound into a personal workspace */
    it("refuses binding a key into another user's personal workspace", async () => {
      const name = `personal-bound-${ns}`;
      const res = await post(adminToken, {
        keyType: "personal",
        name,
        bindings: [
          { role: "ADMIN", scopeType: "TEAM", scopeId: personalTeam.id },
        ],
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("personal_workspace_not_managed_here");

      const minted = await prisma.apiKey.findFirst({
        where: { organizationId: testOrganization.id, name },
      });
      expect(minted).toBeNull();
    });

    it("refuses a service key restricted to a personal project", async () => {
      const name = `personal-service-${ns}`;
      const res = await post(adminToken, {
        keyType: "service",
        name,
        projectIds: [personalProject.id],
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("personal_workspace_not_managed_here");
    });

    /** @scenario The owner of a personal workspace may bind their own key into it */
    it("lets the workspace owner bind their own key to their personal project", async () => {
      const created = await apiKeyService.create({
        name: `owner-personal-${ns}`,
        userId: ownerUserId,
        createdByUserId: ownerUserId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: "ADMIN",
            scopeType: "PROJECT",
            scopeId: personalProject.id,
          },
        ],
      });
      expect(created.apiKey.id).toBeDefined();
    });

    it("refuses replacing a key's bindings with one reaching a personal workspace", async () => {
      const { apiKey } = await apiKeyService.create({
        name: `admin-update-target-${ns}`,
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
      });

      await expect(
        apiKeyService.update({
          id: apiKey.id,
          callerUserId: adminUserId,
          callerIsAdmin: true,
          organizationId: testOrganization.id,
          bindings: [
            { role: "ADMIN", scopeType: "TEAM", scopeId: personalTeam.id },
          ],
        }),
      ).rejects.toMatchObject({
        code: "personal_workspace_not_managed_here",
      });
    });
  });
});
