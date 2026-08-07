/**
 * @vitest-environment node
 *
 * @see specs/licensing/management-apis-enterprise-gate.feature
 *
 * Groups are an Enterprise capability: the docs said so and, before the gate,
 * the API did not check. This suite proves the plan is consulted on the live
 * request path: a fully-permissioned admin credential on a FREE plan is
 * refused with the stable 402 code and upgrade guidance, and the same
 * credential passes once the organization is on Enterprise. Auth still wins
 * over the gate: an unauthenticated request stays a 401.
 */
import { generate } from "@langwatch/ksuid";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

const enterprisePlan = { ...FREE_PLAN, type: "ENTERPRISE", free: false };

describe("Feature: Group endpoints behind the Enterprise gate", () => {
  const ns = `groups-gate-${nanoid(8)}`;

  let testOrganization: Organization;
  let userId: string;
  let patToken: string;
  let seededGroupId: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  const authHeaders = () => ({
    Authorization: `Bearer ${patToken}`,
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(enterprisePlan);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
    });

    testOrganization = await prisma.organization.create({
      data: { name: "Groups Gate Org", slug: `--test-org-${ns}` },
    });

    const user = await prisma.user.create({
      data: { name: "Groups Gate User", email: `gate-${ns}@example.com` },
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
      name: `groups-gate-key-${nanoid(6)}`,
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

    const seeded = await prisma.group.create({
      data: {
        id: generate(KSUID_RESOURCES.GROUP).toString(),
        name: `Gate Seeded ${ns}`,
        slug: `gate-seeded-${ns}`,
        organizationId: testOrganization.id,
      },
    });
    seededGroupId = seeded.id;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["groupMembership", { group: { organizationId: testOrganization.id } }],
      ["roleBinding", { organizationId: testOrganization.id }],
      ["group", { organizationId: testOrganization.id }],
      ["apiKey", { organizationId: testOrganization.id }],
      ["organizationUser", { organizationId: testOrganization.id }],
      ["user", { id: userId }],
      ["organization", { id: testOrganization.id }],
    ]);
    await resetApp();
  });

  describe("given an admin credential holding every permission the routes check", () => {
    /** @scenario Group endpoints require an Enterprise plan */
    it("refuses a plan below Enterprise with 402 and admits the same credential on Enterprise", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      // Listing is refused on the plan, not on the request.
      const list = await app.request("/api/groups", {
        headers: authHeaders(),
      });
      expect(list.status).toBe(402);
      const listBody = await list.json();
      expect(listBody.error).toBe("enterprise_plan_required");
      expect(listBody.feature).toBe("GROUPS");
      // Upgrade guidance rides on the refusal for CLI and agent consumers.
      expect(listBody.tips.length).toBeGreaterThan(0);
      expect(listBody.docsUrl).toContain("/pricing");
      // Nothing is disclosed: no group data leaves on the refusal.
      expect(JSON.stringify(listBody)).not.toContain(seededGroupId);

      // Nothing is created either.
      const refusedName = `Gate Refused ${ns}`;
      const create = await app.request("/api/groups", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: refusedName }),
      });
      expect(create.status).toBe(402);
      expect(
        await prisma.group.findFirst({
          where: { organizationId: testOrganization.id, name: refusedName },
        }),
      ).toBeNull();

      // Nothing is changed: a rename is refused and does not land.
      const rename = await app.request(`/api/groups/${seededGroupId}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Renamed Behind The Gate" }),
      });
      expect(rename.status).toBe(402);
      const untouched = await prisma.group.findUniqueOrThrow({
        where: { id: seededGroupId },
      });
      expect(untouched.name).toBe(`Gate Seeded ${ns}`);

      // The same credential passes once the organization is on Enterprise.
      mockGetActivePlan.mockResolvedValue(enterprisePlan);
      const entitled = await app.request("/api/groups", {
        headers: authHeaders(),
      });
      expect(entitled.status).toBe(200);
      const entitledBody = await entitled.json();
      expect(entitledBody.data).toBeDefined();
    });

    it("still answers 401 before the gate when no credential is sent", async () => {
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const res = await app.request("/api/groups");

      expect(res.status).toBe(401);
    });
  });
});
