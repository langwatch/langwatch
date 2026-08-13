/**
 * @vitest-environment node
 *
 * @see specs/webhooks/webhook-endpoints.feature
 *
 * The webhooks app can be perfectly healthy as a standalone Hono app and still
 * be unreachable in production if it is never mounted in the composed API
 * router: the documented family then 404s for every customer, with no compile
 * error and no failing unit test. This suite exercises the composed router,
 * not the standalone app, so the mount itself is what is under test.
 *
 * It also pins the version namespaces, because those are where a mount goes
 * subtly wrong rather than obviously missing: the dated path and `latest` must
 * serve with version headers, the bare path must serve without them, and an
 * unpublished version must 404 from the namespace guard instead of falling
 * through to some other route.
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { createApiRouter } from "~/server/api-router";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { ENTERPRISE_TEST_PLAN } from "~/test-utils/managementApiOrg";
import { KSUID_RESOURCES } from "~/utils/constants";

describe("Feature: Webhooks management API through the composed router", () => {
  const ns = `webhooks-mount-${nanoid(8)}`;

  let testOrganization: Organization;
  let userId: string;
  let apiKeyToken: string;

  const call = (path: string) =>
    createApiRouter().request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKeyToken}`,
        "Content-Type": "application/json",
      },
    });

  beforeAll(async () => {
    // The mount is what is under test; the plan gate on the family would
    // otherwise answer 402 before the route proves it is reachable, so the
    // fixture organization carries the entitlement this family reads.
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async () => ({
          ...ENTERPRISE_TEST_PLAN,
          webhookEndpointsEnabled: true,
        }),
      }),
    });

    testOrganization = await prisma.organization.create({
      data: { name: "Webhooks Mount Org", slug: `--test-org-${ns}` },
    });

    const user = await prisma.user.create({
      data: { name: "Webhooks Mount User", email: `mount-${ns}@example.com` },
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
      name: `webhooks-mount-key-${nanoid(6)}`,
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
    apiKeyToken = created.token;
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["webhookEndpointDelivery", { organizationId: testOrganization?.id }],
        ["webhookEndpoint", { organizationId: testOrganization?.id }],
        ["roleBinding", { organizationId: testOrganization?.id }],
        ["apiKey", { organizationId: testOrganization?.id }],
        ["organizationUser", { organizationId: testOrganization?.id }],
        ["user", { id: userId }],
        ["organization", { id: testOrganization?.id }],
      ]);
    } finally {
      // The suite swapped the global app; leaving its plan provider installed
      // would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  describe("given an entitled organization and an organization-scoped key", () => {
    describe("when the composed router is asked for an RPC operation", () => {
      /** @scenario Operations are named, not implied by the method */
      it("resolves the bare operation path instead of 404ing", async () => {
        const res = await call("/api/webhooks/endpoints.list");

        expect(res.status).toBe(200);
        expect((await res.json()).data).toBeDefined();
      });

      /** @scenario A pinned version, the latest alias and the bare path all serve */
      it("serves the pinned date and latest with version headers, the bare path without", async () => {
        const dated = await call(
          `/api/webhooks/${MANAGEMENT_API_VERSION}/endpoints.list`,
        );
        const latest = await call("/api/webhooks/latest/endpoints.list");
        const bare = await call("/api/webhooks/endpoints.list");

        expect([dated.status, latest.status, bare.status]).toEqual([
          200, 200, 200,
        ]);
        expect(dated.headers.get("X-API-Version")).toBe(MANAGEMENT_API_VERSION);
        expect(dated.headers.get("X-API-Version-Status")).toBe("stable");
        expect(latest.headers.get("X-API-Version-Status")).toBe("latest");
        expect(bare.headers.get("X-API-Version")).toBeNull();
        expect(bare.headers.get("X-API-Version-Status")).toBe("unversioned");
      });

      /** @scenario An unknown version segment is refused rather than falling through */
      it("404s a version the surface never published", async () => {
        const res = await call("/api/webhooks/2020-01-01/endpoints.list");

        expect(res.status).toBe(404);
      });
    });

    /**
     * The v1 surface served no successful request in its whole production
     * lifetime, so it was removed outright rather than aliased. This is the
     * assertion that the removal actually happened end to end.
     */
    describe("when the composed router is asked for a retired v1 path", () => {
      /** @scenario The retired v1 paths are gone */
      it("404s rather than serving or redirecting", async () => {
        const res = await createApiRouter().request(
          "/api/webhooks/v1/endpoints",
          { headers: { Authorization: `Bearer ${apiKeyToken}` } },
        );

        expect(res.status).toBe(404);
      });
    });
  });
});
