/**
 * @vitest-environment node
 *
 * The SOC2 / ISO27001 invariant on `AdminWorkspaceViewAuditService`, against
 * real Postgres: every admin drill-in into another user's Personal Workspace
 * (or another team's Team Workspace) writes an AuditLog row, and the dedup
 * window collapses bursts to one row per (admin, target, kind, 5-min).
 *
 * The OCSF mirror is verified through a spy port: standing up ClickHouse for
 * the mirror insert is heavier than what the mirror assertion is worth.
 *
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 *       specs/ai-gateway/governance/ingestion-attribution.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ADMIN_WORKSPACE_VIEW_ACTION } from "@langwatch/enterprise-governance-contract";
import type { ProjectService } from "@langwatch/project-contract";

import { AdminWorkspaceViewOcsfPort } from "../../ports/admin-workspace-view-audit.port";
import { PrismaAdminWorkspaceViewAuditRepository } from "../../repositories/prisma/prisma.admin-workspace-view-audit.repository";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../admin-workspace-view-audit.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-awva-${suffix}`;
const GOV_PROJECT_ID = `proj-awva-gov-${suffix}`;
const ADMIN_ID = `usr-awva-admin-${suffix}`;
const VICTIM_ID = `usr-awva-victim-${suffix}`;
const TEAM_MEMBER_ID = `usr-awva-tm-${suffix}`;
const PERSONAL_TEAM_ID = `team-awva-personal-${suffix}`;
const SHARED_TEAM_ID = `team-awva-shared-${suffix}`;

/** The mirror the service writes best-effort, as a spy. */
type MirrorInput = Parameters<AdminWorkspaceViewOcsfPort["mirror"]>[0];
const mirror = vi.fn(async (_input: MirrorInput): Promise<void> => undefined);
class SpyOcsf extends AdminWorkspaceViewOcsfPort {
  mirror(input: MirrorInput): Promise<void> {
    return mirror(input);
  }
}

const projects = {
  ensureInternal: async () => ({ id: GOV_PROJECT_ID }),
} as unknown as ProjectService;

describe.skipIf(!databaseUrl)("AdminWorkspaceViewAuditService", () => {
  const service = () =>
    DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository: PrismaAdminWorkspaceViewAuditRepository.create(prisma),
      projects,
      ocsf: new SpyOcsf(),
    });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `AWVA ${suffix}`, slug: `awva-${suffix}` },
    });
    await prisma.user.createMany({
      data: [
        { id: ADMIN_ID, email: `awva-admin-${suffix}@example.com`, name: "Admin" },
        { id: VICTIM_ID, email: `awva-victim-${suffix}@example.com`, name: "Victim" },
        { id: TEAM_MEMBER_ID, email: `awva-tm-${suffix}@example.com`, name: "TeamMember" },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: ADMIN_ID, role: "ADMIN" },
        { organizationId: ORG_ID, userId: VICTIM_ID, role: "MEMBER" },
        { organizationId: ORG_ID, userId: TEAM_MEMBER_ID, role: "MEMBER" },
      ],
    });
    // Victim's personal team — an admin drilling here is the canonical
    // privileged read.
    await prisma.team.create({
      data: {
        id: PERSONAL_TEAM_ID,
        name: `Victim's Personal ${suffix}`,
        slug: `awva-personal-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: VICTIM_ID,
      },
    });
    // Shared team with TEAM_MEMBER as a member and the admin outside it: a
    // drill-in from the admin records, one from the member does not.
    await prisma.team.create({
      data: {
        id: SHARED_TEAM_ID,
        name: `Shared ${suffix}`,
        slug: `awva-shared-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: false,
      },
    });
    await prisma.teamUser.create({
      data: { userId: TEAM_MEMBER_ID, teamId: SHARED_TEAM_ID, role: "MEMBER" },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog
      .deleteMany({
        where: {
          OR: [
            { userId: { in: [ADMIN_ID, VICTIM_ID, TEAM_MEMBER_ID] } },
            { organizationId: ORG_ID },
          ],
        },
      })
      .catch(() => undefined);
    await prisma.teamUser
      .deleteMany({ where: { teamId: { in: [PERSONAL_TEAM_ID, SHARED_TEAM_ID] } } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { id: { in: [PERSONAL_TEAM_ID, SHARED_TEAM_ID] } } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: [ADMIN_ID, VICTIM_ID, TEAM_MEMBER_ID] } } })
      .catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: ORG_ID } }).catch(() => undefined);
  }, 60_000);

  describe("when an admin drills into another user's workspace", () => {
    it("records an audit row for another user's personal workspace", async () => {
      const result = await service().recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: PERSONAL_TEAM_ID,
        kind: "personal",
      });
      expect(result.recorded).toBe(true);
      expect(result.auditLogId).toBeTruthy();

      const row = await prisma.auditLog.findUniqueOrThrow({
        where: { id: result.auditLogId! },
      });
      expect(row.userId).toBe(ADMIN_ID);
      expect(row.organizationId).toBe(ORG_ID);
      expect(row.action).toBe(ADMIN_WORKSPACE_VIEW_ACTION);
      expect(row.targetKind).toBe("personal_workspace");
      expect(row.targetId).toBe(PERSONAL_TEAM_ID);
      expect(row.metadata).toEqual({
        kind: "personal",
        workspaceLabel: `Victim's Personal ${suffix}`,
      });
    });

    /** @scenario "Audit emission is idempotent within a 5-min window per (admin, target, kind)" */
    it("dedups within the 5-minute window, answering recorded=false the second time", async () => {
      const first = await prisma.auditLog.count({
        where: {
          userId: ADMIN_ID,
          action: ADMIN_WORKSPACE_VIEW_ACTION,
          targetId: PERSONAL_TEAM_ID,
        },
      });
      const result = await service().recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: PERSONAL_TEAM_ID,
        kind: "personal",
      });
      expect(result.recorded).toBe(false);
      expect(result.auditLogId).toBeNull();
      const after = await prisma.auditLog.count({
        where: {
          userId: ADMIN_ID,
          action: ADMIN_WORKSPACE_VIEW_ACTION,
          targetId: PERSONAL_TEAM_ID,
        },
      });
      expect(after).toBe(first);
    });

    it("records a team workspace the admin is not a member of", async () => {
      const result = await service().recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: SHARED_TEAM_ID,
        kind: "team",
      });
      expect(result.recorded).toBe(true);

      const row = await prisma.auditLog.findUniqueOrThrow({
        where: { id: result.auditLogId! },
      });
      expect(row.targetKind).toBe("team_workspace");
      expect(row.metadata).toEqual({ kind: "team", workspaceLabel: `Shared ${suffix}` });
    });
  });

  describe("when the viewer is looking at their own workspace", () => {
    /** @scenario "Self-view short-circuit — no audit row for own-workspace or team-member view" */
    it("short-circuits a view of one's own personal workspace without writing a row", async () => {
      const before = await prisma.auditLog.count({
        where: { userId: VICTIM_ID, action: ADMIN_WORKSPACE_VIEW_ACTION },
      });
      const result = await service().recordView({
        actorUserId: VICTIM_ID,
        organizationId: ORG_ID,
        targetTeamId: PERSONAL_TEAM_ID,
        kind: "personal",
      });
      expect(result.recorded).toBe(false);
      expect(result.auditLogId).toBeNull();
      const after = await prisma.auditLog.count({
        where: { userId: VICTIM_ID, action: ADMIN_WORKSPACE_VIEW_ACTION },
      });
      expect(after).toBe(before);
    });

    it("short-circuits a team member's view of their own team", async () => {
      const before = await prisma.auditLog.count({
        where: { userId: TEAM_MEMBER_ID, action: ADMIN_WORKSPACE_VIEW_ACTION },
      });
      const result = await service().recordView({
        actorUserId: TEAM_MEMBER_ID,
        organizationId: ORG_ID,
        targetTeamId: SHARED_TEAM_ID,
        kind: "team",
      });
      expect(result.recorded).toBe(false);
      const after = await prisma.auditLog.count({
        where: { userId: TEAM_MEMBER_ID, action: ADMIN_WORKSPACE_VIEW_ACTION },
      });
      expect(after).toBe(before);
    });
  });

  describe("when the target belongs to another organization", () => {
    it("answers the not-found shape, so nothing is enumerable", async () => {
      // The service must not confirm the team exists by writing a row, and
      // must not answer differently than the never-existed path.
      const foreignOrgId = `org-awva-foreign-${suffix}`;
      const foreignTeamId = `team-awva-foreign-${suffix}`;
      await prisma.organization.create({
        data: { id: foreignOrgId, name: `Foreign ${suffix}`, slug: `awva-foreign-${suffix}` },
      });
      await prisma.team.create({
        data: {
          id: foreignTeamId,
          name: `Foreign team ${suffix}`,
          slug: `awva-foreign-team-${suffix}`,
          organizationId: foreignOrgId,
          isPersonal: false,
        },
      });

      try {
        const result = await service().recordView({
          actorUserId: ADMIN_ID,
          organizationId: ORG_ID,
          targetTeamId: foreignTeamId,
          kind: "team",
        });
        expect(result.recorded).toBe(false);
        expect(result.auditLogId).toBeNull();

        const phantom = await service().recordView({
          actorUserId: ADMIN_ID,
          organizationId: ORG_ID,
          targetTeamId: `team-phantom-${suffix}`,
          kind: "team",
        });
        expect(phantom.recorded).toBe(false);
        expect(phantom.auditLogId).toBeNull();
      } finally {
        await prisma.team.deleteMany({ where: { id: foreignTeamId } }).catch(() => undefined);
        await prisma.organization
          .deleteMany({ where: { id: foreignOrgId } })
          .catch(() => undefined);
      }
    });
  });

  describe("when the OCSF mirror is wired", () => {
    async function withFreshTarget(
      label: string,
      body: (teamId: string) => Promise<void>,
    ): Promise<void> {
      const teamId = `team-awva-${label}-${suffix}`;
      const userId = `usr-awva-${label}-${suffix}`;
      await prisma.user.create({
        data: { id: userId, email: `awva-${label}-${suffix}@example.com`, name: label },
      });
      await prisma.organizationUser.create({
        data: { organizationId: ORG_ID, userId, role: "MEMBER" },
      });
      await prisma.team.create({
        data: {
          id: teamId,
          name: `${label} personal ${suffix}`,
          slug: `awva-${label}-${suffix}`,
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: userId,
        },
      });
      try {
        await body(teamId);
      } finally {
        await prisma.team.deleteMany({ where: { id: teamId } });
        await prisma.organizationUser.deleteMany({ where: { userId, organizationId: ORG_ID } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    }

    it("emits the mirror keyed by the audit-log id", async () => {
      mirror.mockClear();
      await withFreshTarget("fresh", async (teamId) => {
        const result = await service().recordView({
          actorUserId: ADMIN_ID,
          organizationId: ORG_ID,
          targetTeamId: teamId,
          kind: "personal",
        });
        expect(result.recorded).toBe(true);
        expect(mirror).toHaveBeenCalledTimes(1);
        expect(mirror.mock.calls[0]![0]).toMatchObject({
          tenantId: GOV_PROJECT_ID,
          auditLogId: result.auditLogId,
          view: { actorUserId: ADMIN_ID, targetTeamId: teamId, kind: "personal" },
        });
      });
    });

    it("writes the audit row even when the mirror fails", async () => {
      mirror.mockClear();
      mirror.mockRejectedValueOnce(new Error("clickhouse explode"));
      await withFreshTarget("ocsf-fail", async (teamId) => {
        const result = await service().recordView({
          actorUserId: ADMIN_ID,
          organizationId: ORG_ID,
          targetTeamId: teamId,
          kind: "personal",
        });
        // The SOC2 contract: the AuditLog row is written even though the
        // mirror failed.
        expect(result.recorded).toBe(true);
        expect(result.auditLogId).toBeTruthy();
        const row = await prisma.auditLog.findUnique({ where: { id: result.auditLogId! } });
        expect(row).not.toBeNull();
      });
    });
  });
});
