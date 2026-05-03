/**
 * @vitest-environment node
 *
 * Regression integration test for the AI-Governance tRPC RBAC drift fix.
 *
 * Background: the catalog in `api/rbac.ts` declares 5 governance
 * resources (governance, ingestionSources, anomalyRules,
 * complianceExport, activityMonitor) attached to org ADMIN only.
 * MEMBER + EXTERNAL roles get nothing by default. The catalog tests in
 * `rbac.test.ts` already cover the *role bag* shape.
 *
 * What this file proves: the routers themselves *enforce* the catalog.
 * Before the fix, every read endpoint gated on `organization:view`
 * (which MEMBER has), so the sidebar gate `a85ba27ff` was the only
 * line of defense. Now every governance read/write procedure gates on
 * the resource-specific permission, and a MEMBER session calling
 * directly via tRPC gets UNAUTHORIZED.
 *
 * Routers covered:
 *   - governance.setupState  — `governance:view`
 *   - governance.ocsfExport  — `complianceExport:view`
 *   - ingestionSources.list/create  — `ingestionSources:view/manage`
 *   - anomalyRules.list/create  — `anomalyRules:view/manage`
 *   - activityMonitor.summary  — `activityMonitor:view`
 *
 * Not covered here (already gated correctly elsewhere):
 *   - governance.resolveHome  — `organization:view` (identity routing
 *     for ALL members; gating it on `governance:view` would break
 *     `/` for non-admins)
 *   - personalVirtualKeys.*  — self-service, all members can mint
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";

import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";

// The new requireEnterprisePlan middleware (Phase 4b-4/5) 403s every
// gated governance procedure for non-enterprise plans. This test pins
// RBAC behavior, not license behavior, so we override the plan provider
// to ENTERPRISE for the duration. The license-gate behavior itself is
// covered by license-gate-governance.integration.test.ts.
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

describe("governance routers — RBAC enforcement", () => {
    const ns = `gov-rbac-${nanoid(8)}`;

    let organizationId: string;
    let adminUserId: string;
    let memberUserId: string;

    beforeAll(async () => {
      // resolveHome touches UsageStatsService which expects the app
      // singleton initialised. Other procedures don't need it but
      // initialising once keeps the test simple.
      resetApp();
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: async () => enterprisePlan,
        }),
      });

      const organization = await prisma.organization.create({
        data: {
          name: `Gov RBAC Org ${ns}`,
          slug: `--gov-${ns}`,
        },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: `Gov RBAC Team ${ns}`,
          slug: `--gov-team-${ns}`,
          organizationId,
        },
      });

      // Org ADMIN — needs both OrganizationUser + ORG-scoped RoleBinding so
      // the governance permissions are picked up via checkPermissionFromBindings.
      const admin = await prisma.user.create({
        data: { name: "Gov Admin", email: `gov-admin-${ns}@example.com` },
      });
      adminUserId = admin.id;
      await prisma.organizationUser.create({
        data: {
          userId: admin.id,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.teamUser.create({
        data: {
          userId: admin.id,
          teamId: team.id,
          role: TeamUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: admin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });

      // Org MEMBER — bag has only `organization:view`, none of the
      // governance permissions. Before the fix this user could call every
      // governance read endpoint successfully (they had `organization:view`).
      const member = await prisma.user.create({
        data: { name: "Gov Member", email: `gov-member-${ns}@example.com` },
      });
      memberUserId = member.id;
      await prisma.organizationUser.create({
        data: {
          userId: member.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      await prisma.teamUser.create({
        data: {
          userId: member.id,
          teamId: team.id,
          role: TeamUserRole.MEMBER,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: member.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
    });

    afterAll(async () => {
      await prisma.roleBinding
        .deleteMany({ where: { organizationId } })
        .catch(() => {});
      await prisma.teamUser
        .deleteMany({
          where: { team: { slug: { startsWith: `--gov-team-${ns}` } } },
        })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organizationId } })
        .catch(() => {});
      await prisma.team
        .deleteMany({ where: { slug: { startsWith: `--gov-team-${ns}` } } })
        .catch(() => {});
      await prisma.organization
        .deleteMany({ where: { slug: `--gov-${ns}` } })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: {
            email: {
              in: [
                `gov-admin-${ns}@example.com`,
                `gov-member-${ns}@example.com`,
              ],
            },
          },
        })
        .catch(() => {});
    });

    function callerFor(userId: string) {
      const ctx = createInnerTRPCContext({
        session: { user: { id: userId }, expires: "1" } as any,
      });
      return appRouter.createCaller(ctx);
    }

    describe("when caller is org MEMBER", () => {
      it("rejects governance.setupState with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.governance.setupState({ organizationId }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("rejects governance.ocsfExport with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.governance.ocsfExport({ organizationId, limit: 10 }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("rejects ingestionSources.list with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.ingestionSources.list({ organizationId }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("rejects ingestionSources.create with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.ingestionSources.create({
            organizationId,
            sourceType: "otel_generic",
            name: "leaked-source",
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("rejects anomalyRules.list with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.anomalyRules.list({ organizationId }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("rejects anomalyRules.create with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.anomalyRules.create({
            organizationId,
            name: "leaked-rule",
            severity: "warning",
            ruleType: "spend_spike",
            scope: "organization",
            scopeId: organizationId,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("rejects activityMonitor.summary with UNAUTHORIZED", async () => {
        const caller = callerFor(memberUserId);
        await expect(
          caller.activityMonitor.summary({ organizationId, windowDays: 7 }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });

      it("still ALLOWS governance.resolveHome (identity routing path)", async () => {
        // resolveHome must remain callable by MEMBER so `/` redirects work
        // for non-admins. The persona resolver returns `/me` or
        // `/[project]/messages` — never `/governance` — for users without
        // `organization:manage`. Gating this on `governance:view` would
        // break the LLMOps majority experience.
        const caller = callerFor(memberUserId);
        const result = await caller.governance.resolveHome({ organizationId });
        expect(result).toBeDefined();
        expect(result.persona).not.toBe("p4_admin");
      });
    });

    describe("when caller is org ADMIN", () => {
      it("allows governance.setupState", async () => {
        const caller = callerFor(adminUserId);
        const result = await caller.governance.setupState({ organizationId });
        expect(result).toMatchObject({
          governanceActive: expect.any(Boolean),
        });
      });

      it("allows ingestionSources.list (returns empty array on fresh org)", async () => {
        const caller = callerFor(adminUserId);
        const result = await caller.ingestionSources.list({ organizationId });
        expect(Array.isArray(result)).toBe(true);
      });

      it("allows anomalyRules.list (returns empty array on fresh org)", async () => {
        const caller = callerFor(adminUserId);
        const result = await caller.anomalyRules.list({ organizationId });
        expect(Array.isArray(result)).toBe(true);
      });
    });
  });
