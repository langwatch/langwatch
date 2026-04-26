/**
 * @vitest-environment node
 *
 * Integration coverage for the GatewayAuditLog → AuditLog consolidation.
 *
 * Hits real PG (testcontainers) — NO MOCKS. Validates that:
 *   1. Gateway services (VirtualKey) write rows to the platform `AuditLog`
 *      table with the gateway shape (targetKind / targetId / before / after).
 *   2. The unified `getAuditLogs` query returns those rows with
 *      `source = "gateway"`.
 *   3. Filtering by `targetKind` / `targetId` returns only rows for that
 *      resource (deep-link path from VK / Budget detail pages).
 *   4. The `GatewayAuditLog` table no longer exists post-migration —
 *      `prisma.gatewayAuditLog` is undefined at runtime.
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
import { VirtualKeyService } from "../virtualKey.service";

const suffix = nanoid(8);
const ORG_ID = `org-audit-${suffix}`;
const TEAM_ID = `team-audit-${suffix}`;
const PROJECT_ID = `proj-audit-${suffix}`;
const ACTOR_USER_ID = `usr-audit-${suffix}`;

// VK creation hashes secrets with HMAC(LW_VIRTUAL_KEY_PEPPER, vk_secret).
// In CI the env isn't pre-populated for integration tests; set a deterministic
// fixture value before the suite starts so VirtualKeyService.create works.
process.env.LW_VIRTUAL_KEY_PEPPER ??=
  "0000000000000000000000000000000000000000000000000000000000000000";

describe("AuditLog consolidation — gateway writes land in platform AuditLog", () => {
  const organizations = new PrismaOrganizationRepository(prisma);

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
    await prisma.virtualKey.deleteMany({ where: { projectId: PROJECT_ID } });
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
    it("the prisma client no longer exposes gatewayAuditLog", () => {
      // Post-consolidation `prisma.gatewayAuditLog` is undefined — would
      // throw at runtime. Guard against accidental re-introduction.
      expect((prisma as unknown as Record<string, unknown>).gatewayAuditLog)
        .toBeUndefined();
    });
  });

  describe("when a Virtual Key is created", () => {
    it("writes a single AuditLog row in gateway shape", async () => {
      const service = VirtualKeyService.create(prisma);

      const before = await prisma.auditLog.count({
        where: { organizationId: ORG_ID, action: "VIRTUAL_KEY_CREATED" },
      });

      const { virtualKey } = await service.create({
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        name: `audit-vk-${suffix}`,
        environment: "test",
        actorUserId: ACTOR_USER_ID,
        providerCredentialIds: [],
      });

      const rows = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_ID,
          targetKind: "virtual_key",
          targetId: virtualKey.id,
          action: "VIRTUAL_KEY_CREATED",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.userId).toBe(ACTOR_USER_ID);
      expect(row.organizationId).toBe(ORG_ID);
      expect(row.projectId).toBe(PROJECT_ID);
      expect(row.targetKind).toBe("virtual_key");
      expect(row.targetId).toBe(virtualKey.id);
      expect(row.before).toBeNull();
      expect(row.after).not.toBeNull();

      // Sanity: total VIRTUAL_KEY_CREATED rows for this org went up by 1.
      const after = await prisma.auditLog.count({
        where: { organizationId: ORG_ID, action: "VIRTUAL_KEY_CREATED" },
      });
      expect(after).toBe(before + 1);
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
      // Use the most-recent VK we created above as the deep-link target.
      const recent = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          targetKind: "virtual_key",
          action: "VIRTUAL_KEY_CREATED",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(recent).not.toBeNull();
      const targetId = recent!.targetId!;

      const result = await organizations.getAuditLogs({
        organizationId: ORG_ID,
        pageOffset: 0,
        pageSize: 25,
        targetKind: "virtual_key",
        targetId,
      });

      expect(result.auditLogs.length).toBeGreaterThan(0);
      for (const row of result.auditLogs) {
        expect(row.targetId).toBe(targetId);
      }
    });
  });
});
