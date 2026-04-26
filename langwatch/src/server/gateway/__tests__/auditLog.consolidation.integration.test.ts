/**
 * @vitest-environment node
 *
 * Integration coverage for the GatewayAuditLog → AuditLog consolidation.
 *
 * Hits real PG (testcontainers) — NO MOCKS. Validates that:
 *   1. `GatewayAuditLogRepository.append` writes rows to the platform
 *      `AuditLog` table with the gateway shape (targetKind / targetId /
 *      before / after) — the adapter's whole purpose.
 *   2. The unified `getAuditLogs` query returns those rows with
 *      `source = "gateway"`.
 *   3. Filtering by `targetKind` / `targetId` returns only rows for that
 *      resource (deep-link path from VK / Budget detail pages).
 *   4. The `GatewayAuditLog` table no longer exists post-migration —
 *      `prisma.gatewayAuditLog` is undefined at runtime. (Live PG probe
 *      via `$queryRaw` is blocked by multitenancy middleware; client-
 *      shape check is the practical regression guard since the client
 *      is generated from the same schema.prisma that gates the migration.)
 *
 * The adapter is exercised directly rather than through VirtualKeyService —
 * the service has its own unit tests for the upstream `auditLog.append` call;
 * this suite is about proving the *table* under it changed.
 *
 * Spec: specs/audit-log/audit-log.feature
 * Migration: prisma/migrations/20260425000000_consolidate_gateway_audit_into_audit_log
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayAuditLogRepository } from "../auditLog.repository";

const suffix = nanoid(8);
const ORG_ID = `org-audit-${suffix}`;
const TEAM_ID = `team-audit-${suffix}`;
const PROJECT_ID = `proj-audit-${suffix}`;
const ACTOR_USER_ID = `usr-audit-${suffix}`;
const VK_ID = `vk-audit-${suffix}`;
const BUDGET_ID = `bdg-audit-${suffix}`;

describe("AuditLog consolidation — gateway writes land in platform AuditLog", () => {
  const organizations = new PrismaOrganizationRepository(prisma);
  const auditLog = new GatewayAuditLogRepository(prisma);

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Audit Org ${suffix}`, slug: `audit-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Audit Team ${suffix}`,
        slug: `audit-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Audit Project ${suffix}`,
        slug: `audit-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: ACTOR_USER_ID,
        email: `${suffix}@audit.local`,
        name: "Audit Actor",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: ACTOR_USER_ID, role: "ADMIN" },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID, userId: ACTOR_USER_ID },
    });
    await prisma.user.deleteMany({ where: { id: ACTOR_USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 60_000);

  describe("when GatewayAuditLog table is dropped", () => {
    it("drops gatewayAuditLog from the prisma client", () => {
      // Post-consolidation `prisma.gatewayAuditLog` is undefined — would
      // throw at runtime. Since the Prisma client is generated from
      // schema.prisma at build time, this also confirms the model was
      // removed from the schema definition (which is what gates the
      // SQL migration that drops the table). A live PG `to_regclass`
      // probe would be stronger but is blocked by our multitenancy
      // middleware which rejects `$queryRaw` calls — see
      // `src/utils/dbMultiTenancyProtection.ts`.
      expect((prisma as unknown as Record<string, unknown>).gatewayAuditLog)
        .toBeUndefined();
    });
  });

  describe("when the gateway audit adapter writes a VK row", () => {
    it("creates an AuditLog row in gateway shape (targetKind + before/after)", async () => {
      const before = await prisma.auditLog.count({
        where: { organizationId: ORG_ID, action: "gateway.virtual_key.created" },
      });

      await auditLog.append({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
        action: "gateway.virtual_key.created",
        targetKind: "virtual_key",
        targetId: VK_ID,
        before: null,
        after: { name: `audit-vk-${suffix}`, status: "active" },
      });

      const rows = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_ID,
          targetKind: "virtual_key",
          targetId: VK_ID,
          action: "gateway.virtual_key.created",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.userId).toBe(ACTOR_USER_ID);
      expect(row.organizationId).toBe(ORG_ID);
      expect(row.projectId).toBe(PROJECT_ID);
      expect(row.targetKind).toBe("virtual_key");
      expect(row.targetId).toBe(VK_ID);
      expect(row.before).toBeNull();
      expect(row.after).not.toBeNull();
      expect(row.after).toMatchObject({ status: "active" });

      // Sanity: total gateway.virtual_key.created rows for this org went up by 1.
      const after = await prisma.auditLog.count({
        where: { organizationId: ORG_ID, action: "gateway.virtual_key.created" },
      });
      expect(after).toBe(before + 1);
    });

    it("captures before/after diff on update events", async () => {
      await auditLog.append({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        actorUserId: ACTOR_USER_ID,
        action: "gateway.budget.updated",
        targetKind: "budget",
        targetId: BUDGET_ID,
        before: { limitUsd: "500" },
        after: { limitUsd: "1000" },
      });

      const row = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          targetKind: "budget",
          targetId: BUDGET_ID,
          action: "gateway.budget.updated",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(row).not.toBeNull();
      expect(row!.before).toMatchObject({ limitUsd: "500" });
      expect(row!.after).toMatchObject({ limitUsd: "1000" });
    });
  });

  describe("when getAuditLogs is queried for the org", () => {
    it("returns gateway rows with source='gateway'", async () => {
      const result = await organizations.getAuditLogs({
        organizationId: ORG_ID,
        pageOffset: 0,
        pageSize: 25,
      });

      const gatewayRows = result.auditLogs.filter((r) => r.source === "gateway");
      expect(gatewayRows.length).toBeGreaterThan(0);

      const sample = gatewayRows[0]!;
      expect(sample.targetKind).not.toBeNull();
      expect(sample.targetId).not.toBeNull();
      expect(sample.user).not.toBeNull();
      expect(sample.user?.id).toBe(ACTOR_USER_ID);
    });

    it("filters to gateway-only when targetKind is set (deep-link path)", async () => {
      const result = await organizations.getAuditLogs({
        organizationId: ORG_ID,
        pageOffset: 0,
        pageSize: 25,
        targetKind: "virtual_key",
      });

      expect(result.auditLogs.length).toBeGreaterThan(0);
      // Every returned row must be gateway-source — platform rows have null
      // targetKind so they cannot match.
      for (const row of result.auditLogs) {
        expect(row.source).toBe("gateway");
        expect(row.targetKind).toBe("virtual_key");
      }
    });

    it("filters to a specific resource when targetId is set", async () => {
      const result = await organizations.getAuditLogs({
        organizationId: ORG_ID,
        pageOffset: 0,
        pageSize: 25,
        targetKind: "virtual_key",
        targetId: VK_ID,
      });

      expect(result.auditLogs.length).toBeGreaterThan(0);
      for (const row of result.auditLogs) {
        expect(row.targetId).toBe(VK_ID);
      }
    });
  });
});
