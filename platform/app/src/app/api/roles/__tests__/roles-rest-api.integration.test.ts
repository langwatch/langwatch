/**
 * @vitest-environment node
 *
 * @see specs/rbac/roles-rest-api.feature
 *
 * Custom roles over REST: organization-scoped lookups (another organization's
 * role id reads as not found), the natural-key 409 on names, wholesale
 * permission replacement, and the permission catalog with its
 * organization-exclusive annotations.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { MANAGEMENT_API_VERSION } from "@langwatch/platform-api/app-rest";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  ENTERPRISE_TEST_PLAN,
  type ManagementTestOrg,
  seedManagementOrg,
} from "~/test-utils/managementApiOrg";
import { getApp } from "~/server/app-layer/app";
import { createRolesRestApp } from "@langwatch/platform-api";
import { appRestManagement } from "~/server/api/management/managed-service";
import { appRestRbacVocabulary } from "~/server/api/management/rbac-vocabulary";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";

const app = createRolesRestApp({
  management: appRestManagement,
  roles: () => getApp().roles,
  vocabulary: appRestRbacVocabulary,
  ledgerActor: orgRequestLedgerActor,
});

describe("Feature: Custom roles REST API", () => {
  const ns = `roles-rest-${nanoid(8)}`;

  let seeded: ManagementTestOrg;
  let otherOrgId: string;
  let otherOrgRoleId: string;

  const authHeaders = () => ({
    Authorization: `Bearer ${seeded.adminToken}`,
    "Content-Type": "application/json",
  });

  const createRole = async (body: {
    name: string;
    description?: string;
    permissions: string[];
  }) => {
    const response = await app.request(`/api/roles/${MANAGEMENT_API_VERSION}/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    return response;
  };

  beforeAll(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi
          .fn()
          .mockResolvedValue(ENTERPRISE_TEST_PLAN) as PlanProvider["getActivePlan"],
      }),
    });

    seeded = await seedManagementOrg({ prisma, ns });

    const otherOrg = await prisma.organization.create({
      data: { name: `Other Org ${ns}`, slug: `--test-org-other-${ns}` },
    });
    otherOrgId = otherOrg.id;
    const otherRole = await prisma.customRole.create({
      data: {
        organizationId: otherOrg.id,
        name: `Foreign Role ${ns}`,
        permissions: ["project:view"],
        kind: "custom",
      },
    });
    otherOrgRoleId = otherRole.id;
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["roleBinding", { organizationId: seeded?.organization.id }],
        ["apiKey", { organizationId: seeded?.organization.id }],
        ["customRole", { organizationId: seeded?.organization.id }],
        ["customRole", { organizationId: otherOrgId }],
        ["organizationUser", { organizationId: seeded?.organization.id }],
        ["user", { id: seeded?.adminUserId }],
        ["organization", { id: seeded?.organization.id }],
        ["organization", { id: otherOrgId }],
      ]);
    } finally {
      // The suite swapped the global app; leaving its mocked plan provider
      // installed would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  describe("given custom roles in two organizations", () => {
    /** @scenario Listing custom roles returns the organization's roles */
    it("returns this organization's roles with permissions and never the other's", async () => {
      const releaseManager = await createRole({
        name: `Release Manager ${ns}`,
        permissions: ["project:view", "prompts:manage"],
      });
      expect(releaseManager.status).toBe(201);
      const auditor = await createRole({
        name: `Auditor ${ns}`,
        permissions: ["auditLog:view"],
      });
      expect(auditor.status).toBe(201);

      const response = await app.request(`/api/roles/${MANAGEMENT_API_VERSION}/`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      const names = body.roles.map((role: { name: string }) => role.name);
      expect(names).toEqual(
        expect.arrayContaining([`Release Manager ${ns}`, `Auditor ${ns}`]),
      );
      const listed = body.roles.find(
        (role: { name: string }) => role.name === `Release Manager ${ns}`,
      );
      expect(listed.permissions).toEqual(
        expect.arrayContaining(["project:view", "prompts:manage"]),
      );
      expect(
        body.roles.find((role: { id: string }) => role.id === otherOrgRoleId),
      ).toBeUndefined();
    });

    /** @scenario Creating a role from permission keys succeeds */
    it("creates a role carrying id, name, description and both permissions", async () => {
      const response = await createRole({
        name: `Creator Role ${ns}`,
        description: "Ships releases",
        permissions: ["project:view", "prompts:manage"],
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe(`Creator Role ${ns}`);
      expect(body.description).toBe("Ships releases");
      expect(body.permissions).toEqual(
        expect.arrayContaining(["project:view", "prompts:manage"]),
      );
    });

    /** @scenario Creating a role with an unknown permission key is refused */
    it("refuses an unknown permission key with validation_error and writes nothing", async () => {
      const response = await createRole({
        name: `Teleporter ${ns}`,
        permissions: ["project:teleport"],
      });

      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("validation_error");
      expect(
        await prisma.customRole.findFirst({
          where: {
            organizationId: seeded.organization.id,
            name: `Teleporter ${ns}`,
          },
        }),
      ).toBeNull();
    });

    /** @scenario Creating a role with a taken name is refused */
    it("answers the deterministic conflict instead of minting a second role", async () => {
      const first = await createRole({
        name: `Taken Name ${ns}`,
        permissions: ["project:view"],
      });
      expect(first.status).toBe(201);

      const second = await createRole({
        name: `Taken Name ${ns}`,
        permissions: ["prompts:manage"],
      });

      expect(second.status).toBe(409);
      expect((await second.json()).code).toBe("custom_role_name_taken");
      expect(
        await prisma.customRole.count({
          where: {
            organizationId: seeded.organization.id,
            name: `Taken Name ${ns}`,
          },
        }),
      ).toBe(1);
    });

    /** @scenario Fetching a role by id returns it */
    it("returns every field creating the role accepted", async () => {
      const created = await (
        await createRole({
          name: `Fetch Role ${ns}`,
          description: "Reads back",
          permissions: ["traces:view"],
        })
      ).json();

      const response = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          headers: authHeaders(),
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        id: created.id,
        name: `Fetch Role ${ns}`,
        description: "Reads back",
        permissions: ["traces:view"],
      });
    });

    /** @scenario Fetching a role from another organization is refused */
    it("answers custom_role_not_found for another organization's role id", async () => {
      const response = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/${otherOrgRoleId}`,
        {
          headers: authHeaders(),
        },
      );

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("custom_role_not_found");
    });

    /** @scenario Replacing a role's permission set takes effect */
    it("replaces the permission set outright", async () => {
      const created = await (
        await createRole({
          name: `Replace Role ${ns}`,
          permissions: ["project:view", "prompts:manage"],
        })
      ).json();

      const response = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ permissions: ["project:view"] }),
        },
      );
      expect(response.status).toBe(200);

      const readBack = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          headers: authHeaders(),
        },
      );
      expect((await readBack.json()).permissions).toEqual(["project:view"]);
    });

    /** @scenario Deleting an unbound role succeeds */
    it("deletes an unbound role, after which it reads as not found", async () => {
      const created = await (
        await createRole({
          name: `Delete Role ${ns}`,
          permissions: ["project:view"],
        })
      ).json();

      const response = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);

      const readBack = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          headers: authHeaders(),
        },
      );
      expect(readBack.status).toBe(404);
      expect((await readBack.json()).code).toBe("custom_role_not_found");
    });

    /** @scenario The permission catalog lists organization-exclusive permissions */
    it("groups permissions by resource and marks the organization-exclusive ones", async () => {
      const response = await app.request(
        `/api/roles/${MANAGEMENT_API_VERSION}/permissions`,
        {
          headers: authHeaders(),
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.resources.length).toBeGreaterThanOrEqual(35);

      for (const entry of body.resources) {
        expect(entry.permissions.length).toBeGreaterThan(0);
        for (const permission of entry.permissions) {
          expect(permission.startsWith(`${entry.resource}:`)).toBe(true);
        }
      }

      const organization = body.resources.find(
        (entry: { resource: string }) => entry.resource === "organization",
      );
      expect(organization.organizationExclusive).toBe(true);
      const governance = body.resources.find(
        (entry: { resource: string }) => entry.resource === "governance",
      );
      expect(governance.organizationExclusive).toBe(true);
      const prompts = body.resources.find(
        (entry: { resource: string }) => entry.resource === "prompts",
      );
      expect(prompts.organizationExclusive).toBe(false);
    });
  });
});
