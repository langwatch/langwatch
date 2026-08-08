/**
 * @vitest-environment node
 *
 * @see specs/groups/groups-rest-api.feature
 *
 * The groups app can be perfectly healthy as a standalone Hono app and still
 * be unreachable in production if it is never mounted in the composed API
 * router: the documented family then 404s for every customer. This suite
 * exercises the composed router, not the standalone app, so the mount itself
 * is what is under test.
 */
import { generate } from "@langwatch/ksuid";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { createApiRouter } from "~/server/api-router";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { ENTERPRISE_TEST_PLAN } from "~/test-utils/managementApiOrg";
import { KSUID_RESOURCES } from "~/utils/constants";

describe("Feature: Groups REST API through the composed router", () => {
  const ns = `groups-mount-${nanoid(8)}`;

  let testOrganization: Organization;
  let userId: string;
  let patToken: string;

  beforeAll(async () => {
    // The mount is what is under test; the Enterprise gate on the family
    // would otherwise answer 402 before the route proves it is reachable, so
    // the fixture organization is entitled.
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async () => ENTERPRISE_TEST_PLAN,
      }),
    });

    testOrganization = await prisma.organization.create({
      data: { name: "Groups Mount Org", slug: `--test-org-${ns}` },
    });

    const user = await prisma.user.create({
      data: { name: "Groups Mount User", email: `mount-${ns}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
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

    const created = await ApiKeyService.create(prisma).create({
      name: `groups-mount-key-${nanoid(6)}`,
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
    try {
      await cleanupTestRows(prisma, [
        ["roleBinding", { organizationId: testOrganization?.id }],
        ["apiKey", { organizationId: testOrganization?.id }],
        ["customRole", { organizationId: testOrganization?.id }],
        ["organizationUser", { organizationId: testOrganization?.id }],
        ["user", { id: userId }],
        ["organization", { id: testOrganization?.id }],
      ]);
    } finally {
      // The suite swapped the global app; leaving its mocked plan provider
      // installed would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  /** @scenario The groups API is reachable through the composed router */
  it("resolves GET /api/groups instead of 404ing", async () => {
    const api = createApiRouter();
    const res = await api.request("/api/groups", {
      headers: { Authorization: `Bearer ${patToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.pagination).toBeDefined();
  });
});
