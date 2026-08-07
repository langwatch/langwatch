/**
 * @vitest-environment node
 *
 * @see specs/licensing/management-apis-enterprise-gate.feature
 *
 * The plan gate on the four management families built through
 * `createManagementService`: a fully-permissioned credential on a plan below
 * Enterprise is refused with the stable 402 code and upgrade guidance, the
 * same credential passes on Enterprise, and the RBAC denial always beats the
 * plan denial (403 before 402), because "you don't have access" must never be
 * dressed up as "buy a plan".
 */

import { FREE_PLAN } from "@ee/licensing/constants";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app as organizationApp } from "~/app/api/organization/[[...route]]/app";
import { app as roleBindingsApp } from "~/app/api/role-bindings/[[...route]]/app";
import { app as rolesApp } from "~/app/api/roles/[[...route]]/app";
import { app as scimTokensApp } from "~/app/api/scim-tokens/[[...route]]/app";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  ENTERPRISE_TEST_PLAN,
  type ManagementTestOrg,
  seedManagementOrg,
  seedOrgMember,
} from "~/test-utils/managementApiOrg";

describe("Feature: Management APIs require an Enterprise plan", () => {
  const ns = `mgmt-gate-${nanoid(8)}`;

  let seeded: ManagementTestOrg;
  let viewOnlyToken: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  const authHeaders = () => ({
    Authorization: `Bearer ${seeded.adminToken}`,
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue({ ...FREE_PLAN });
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
    });

    seeded = await seedManagementOrg({ prisma, ns });

    // A MEMBER holds organization:view but not organization:manage, so a
    // manage-gated route refuses them on RBAC before the plan is consulted.
    const member = await seedOrgMember({
      prisma,
      ns,
      organizationId: seeded.organization.id,
      role: OrganizationUserRole.MEMBER,
      label: "view-only",
      withOrgBinding: true,
    });
    const memberKey = await ApiKeyService.create(prisma).create({
      name: `mgmt-gate-member-key-${nanoid(6)}`,
      userId: member.userId,
      createdByUserId: member.userId,
      organizationId: seeded.organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.MEMBER,
          scopeType: "ORGANIZATION",
          scopeId: seeded.organization.id,
        },
      ],
    });
    viewOnlyToken = memberKey.token;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId: seeded.organization.id }],
      ["apiKey", { organizationId: seeded.organization.id }],
      ["organizationUser", { organizationId: seeded.organization.id }],
      ["user", { email: { endsWith: `-${ns}@example.com` } }],
      ["organization", { id: seeded.organization.id }],
    ]);
    await resetApp();
  });

  describe("given a fully-permissioned credential on a plan below Enterprise", () => {
    /** @scenario The organization API requires an Enterprise plan */
    it("refuses the organization API with 402, naming the feature and the way up", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const response = await organizationApp.request("/api/organization", {
        headers: authHeaders(),
      });

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.code).toBe("enterprise_plan_required");
      expect(body.meta.feature).toBe("MANAGEMENT_API");
      expect(body.tips.length).toBeGreaterThan(0);
      expect(body.docsUrl).toBeTruthy();

      mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);
      const entitled = await organizationApp.request("/api/organization", {
        headers: authHeaders(),
      });
      expect(entitled.status).toBe(200);
    });

    /** @scenario The roles API requires an Enterprise plan */
    it("refuses the roles API with 402", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const response = await rolesApp.request("/api/roles", {
        headers: authHeaders(),
      });

      expect(response.status).toBe(402);
      expect((await response.json()).code).toBe("enterprise_plan_required");
    });

    /** @scenario The role bindings API requires an Enterprise plan */
    it("refuses the role bindings API with 402", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const response = await roleBindingsApp.request("/api/role-bindings", {
        headers: authHeaders(),
      });

      expect(response.status).toBe(402);
      expect((await response.json()).code).toBe("enterprise_plan_required");
    });

    /** @scenario The SCIM tokens API requires an Enterprise plan */
    it("refuses the SCIM tokens API with 402", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const response = await scimTokensApp.request("/api/scim-tokens", {
        headers: authHeaders(),
      });

      expect(response.status).toBe(402);
      expect((await response.json()).code).toBe("enterprise_plan_required");
    });
  });

  describe("given a credential missing the route's permission on the same lapsed plan", () => {
    it("answers 403 insufficient_permissions before the plan gate can answer 402", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const response = await rolesApp.request("/api/roles", {
        headers: {
          Authorization: `Bearer ${viewOnlyToken}`,
          "Content-Type": "application/json",
        },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.code).toBe("insufficient_permissions");
      expect(body.meta.required_permission).toBe("organization:manage");

      mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);
    });
  });

  describe("given no credential at all", () => {
    it("still answers 401 before the gate", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const response = await organizationApp.request("/api/organization");

      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("missing_credentials");

      mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);
    });
  });
});
