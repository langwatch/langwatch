/**
 * @vitest-environment node
 *
 * Integration coverage for the Enterprise license gate on governance
 * backend procedures (Phase 4b-4/5 + 4c-1). Non-enterprise plan must
 * 403 every gated procedure regardless of how the caller arrives —
 * tRPC router, direct service call, or background worker.
 *
 * Pins:
 *   1. Every gated governance procedure (anomalyRules / activityMonitor /
 *      ingestionSources / governance.ocsfExport) returns FORBIDDEN for
 *      an org ADMIN whose org is on a non-enterprise plan.
 *   2. RBAC denial fires BEFORE the license gate (a MEMBER on a
 *      non-enterprise org gets UNAUTHORIZED, not FORBIDDEN — clearer
 *      error attribution).
 *   3. Service-layer defense-in-depth: IngestionSourceService.createSource
 *      throws FORBIDDEN even when called directly (no router middleware).
 *
 * Apache-2.0 floor — these MUST keep working on non-enterprise plans:
 *   - aiTools.* (Phase 7 portal)
 *   - governance.setupState (per-user nav helper)
 *
 * Spec: specs/ai-gateway/license-gate-governance.feature
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FREE_PLAN } from "@ee/licensing/constants";
import type { PlanInfo } from "@ee/licensing/planInfo";

import { prisma } from "~/server/db";
import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";

import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";

const ns = `lic-gate-${nanoid(8)}`;

const freePlan: PlanInfo = { ...FREE_PLAN, type: "FREE" };
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

let organizationId: string;
let teamId: string;
let adminUserId: string;
let memberUserId: string;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `License Gate Org ${ns}`, slug: `--lic-${ns}` },
  });
  organizationId = organization.id;

  const team = await prisma.team.create({
    data: {
      name: `License Gate Team ${ns}`,
      slug: `--lic-team-${ns}`,
      organizationId,
    },
  });
  teamId = team.id;

  const admin = await prisma.user.create({
    data: { name: "Admin", email: `lic-admin-${ns}@example.com` },
  });
  adminUserId = admin.id;
  await prisma.organizationUser.create({
    data: { userId: admin.id, organizationId, role: OrganizationUserRole.ADMIN },
  });
  await prisma.teamUser.create({
    data: { userId: admin.id, teamId, role: TeamUserRole.ADMIN },
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

  const member = await prisma.user.create({
    data: { name: "Member", email: `lic-member-${ns}@example.com` },
  });
  memberUserId = member.id;
  await prisma.organizationUser.create({
    data: {
      userId: member.id,
      organizationId,
      role: OrganizationUserRole.MEMBER,
    },
  });
});

afterAll(async () => {
  await prisma.roleBinding.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.teamUser
    .deleteMany({ where: { team: { slug: { startsWith: `--lic-team-` } } } })
    .catch(() => {});
  await prisma.organizationUser.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.team.deleteMany({ where: { slug: { startsWith: `--lic-team-` } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { slug: `--lic-${ns}` } }).catch(() => {});
  await prisma.user
    .deleteMany({
      where: {
        email: {
          in: [`lic-admin-${ns}@example.com`, `lic-member-${ns}@example.com`],
        },
      },
    })
    .catch(() => {});
});

function configureApp(plan: PlanInfo) {
  resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => plan,
    }),
  });
}

function callerFor(userId: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId }, expires: "1" } as any,
  });
  return appRouter.createCaller(ctx);
}

describe("license-gate on governance backend", () => {
  describe("when the org is on a non-enterprise plan", () => {
    beforeAll(() => configureApp(freePlan));

    describe("ADMIN with full RBAC permissions hits the license gate", () => {
      it("forbids anomalyRules.list", async () => {
        await expect(
          callerFor(adminUserId).anomalyRules.list({ organizationId }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("Anomaly rules"),
        });
      });

      it("forbids anomalyRules.create", async () => {
        await expect(
          callerFor(adminUserId).anomalyRules.create({
            organizationId,
            name: "rule-x",
            severity: "warning",
            ruleType: "spend_spike",
            scope: "organization",
            scopeId: organizationId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });

      it("forbids activityMonitor.summary", async () => {
        await expect(
          callerFor(adminUserId).activityMonitor.summary({
            organizationId,
            windowDays: 30,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("activity monitor"),
        });
      });

      it("forbids activityMonitor.spendByUser", async () => {
        await expect(
          callerFor(adminUserId).activityMonitor.spendByUser({
            organizationId,
            windowDays: 30,
            limit: 10,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });

      it("forbids ingestionSources.list", async () => {
        await expect(
          callerFor(adminUserId).ingestionSources.list({ organizationId }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("Ingestion sources"),
        });
      });

      it("forbids ingestionSources.create", async () => {
        await expect(
          callerFor(adminUserId).ingestionSources.create({
            organizationId,
            sourceType: "otel_generic",
            name: "should-be-blocked",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        const persisted = await prisma.ingestionSource.findFirst({
          where: { organizationId, name: "should-be-blocked" },
        });
        expect(persisted).toBeNull();
      });

      it("forbids governance.ocsfExport", async () => {
        await expect(
          callerFor(adminUserId).governance.ocsfExport({
            organizationId,
            limit: 10,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("OCSF"),
        });
      });
    });

    describe("MEMBER hits the RBAC gate first (UNAUTHORIZED before FORBIDDEN)", () => {
      it("rejects anomalyRules.list with UNAUTHORIZED, not FORBIDDEN", async () => {
        // RBAC middleware runs BEFORE the license gate. The MEMBER lacks
        // anomalyRules:view, so they get UNAUTHORIZED. The license gate
        // never fires for a caller without permission.
        await expect(
          callerFor(memberUserId).anomalyRules.list({ organizationId }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      });
    });

    describe("Apache-2.0 floor stays open", () => {
      it("allows governance.setupState (per-user nav helper)", async () => {
        // setupState is intentionally NOT gated — it's a persona-detection
        // signal used to drive nav promotion. The page-level gate is
        // upstream of this read.
        await expect(
          callerFor(adminUserId).governance.setupState({ organizationId }),
        ).resolves.toMatchObject({
          governanceActive: expect.any(Boolean),
        });
      });

      it("allows aiTools.list (Phase 7 portal — works for everyone)", async () => {
        await expect(
          callerFor(adminUserId).aiTools.list({ organizationId }),
        ).resolves.toBeDefined();
      });
    });

    describe("service-layer defense-in-depth", () => {
      it("rejects direct IngestionSourceService.createSource calls without going through tRPC", async () => {
        const service = IngestionSourceService.create(prisma);
        await expect(
          service.createSource({
            organizationId,
            sourceType: "otel_generic",
            name: "service-direct-blocked",
            actorUserId: adminUserId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        const persisted = await prisma.ingestionSource.findFirst({
          where: { organizationId, name: "service-direct-blocked" },
        });
        expect(persisted).toBeNull();
      });
    });
  });

  describe("when the org is on an enterprise plan", () => {
    beforeAll(() => configureApp(enterprisePlan));

    it("ADMIN can list anomaly rules (returns empty array on fresh org)", async () => {
      const result = await callerFor(adminUserId).anomalyRules.list({
        organizationId,
      });
      expect(Array.isArray(result)).toBe(true);
    });

    it("ADMIN can list ingestion sources", async () => {
      const result = await callerFor(adminUserId).ingestionSources.list({
        organizationId,
      });
      expect(Array.isArray(result)).toBe(true);
    });

    it("ADMIN can fetch activity monitor summary", async () => {
      const result = await callerFor(adminUserId).activityMonitor.summary({
        organizationId,
        windowDays: 30,
      });
      expect(result).toBeDefined();
    });

    it("service-layer createSource succeeds when plan is Enterprise", async () => {
      const service = IngestionSourceService.create(prisma);
      const { source, ingestSecret } = await service.createSource({
        organizationId,
        sourceType: "otel_generic",
        name: `service-direct-allowed-${ns}`,
        actorUserId: adminUserId,
      });
      expect(source.id).toBeDefined();
      expect(ingestSecret).toBeTruthy();

      // Cleanup so the test stays idempotent across reruns.
      await prisma.ingestionSource
        .delete({ where: { id: source.id } })
        .catch(() => {});
    });
  });
});
