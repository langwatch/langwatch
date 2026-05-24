/**
 * @vitest-environment node
 *
 * Integration coverage for AdminWorkspaceViewAuditService — pins
 * the SOC2 / ISO27001 invariant that every admin drill-in into
 * another user's Personal Workspace (or another team's Team
 * Workspace) writes an AuditLog row, and that the dedup window
 * collapses bursts to one row per (admin, target, kind, 5-min).
 *
 * OCSF mirror is verified via stub-spy since CH testcontainers
 * setup for OCSF inserts is heavier than the unit value warrants.
 *
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 *       specs/ai-gateway/governance/ingestion-attribution.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";

import {
  ADMIN_WORKSPACE_VIEW_ACTION,
  AdminWorkspaceViewAuditService,
} from "../adminWorkspaceViewAudit.service";
import type { GovernanceOcsfEventsClickHouseRepository } from "../governanceOcsfEvents.clickhouse.repository";

const suffix = nanoid(8);
const ORG_ID = `org-awva-${suffix}`;
const ADMIN_ID = `usr-awva-admin-${suffix}`;
const VICTIM_ID = `usr-awva-victim-${suffix}`;
const TEAM_MEMBER_ID = `usr-awva-tm-${suffix}`;
const PERSONAL_TEAM_ID = `team-awva-personal-${suffix}`;
const SHARED_TEAM_ID = `team-awva-shared-${suffix}`;

describe("AdminWorkspaceViewAuditService", () => {
  const ocsfStub = {
    insertEvent: vi.fn(async () => undefined),
  } as unknown as GovernanceOcsfEventsClickHouseRepository;

  const service = AdminWorkspaceViewAuditService.create({
    prisma,
    ocsfRepository: ocsfStub,
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
    // Victim's personal team — admin drilling here is the canonical
    // privileged-read scenario.
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
    // Shared team with TEAM_MEMBER as a member; admin is NOT a
    // member.  Drill-in from admin should record; drill-in from
    // member should not.
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
      data: {
        userId: TEAM_MEMBER_ID,
        teamId: SHARED_TEAM_ID,
        role: "MEMBER",
      },
    });
  });

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
      .deleteMany({
        where: { id: { in: [ADMIN_ID, VICTIM_ID, TEAM_MEMBER_ID] } },
      })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
  });

  it("records an audit row when admin drills into another user's personal workspace", async () => {
    const result = await service.recordView({
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

  /** @scenario Audit emission is idempotent within a 5-min window per (admin, target, kind) */
  it("dedups within the 5-minute window — second call returns recorded=false", async () => {
    const first = await prisma.auditLog.count({
      where: {
        userId: ADMIN_ID,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
        targetId: PERSONAL_TEAM_ID,
      },
    });
    const result = await service.recordView({
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

  it("records when admin drills into a team workspace they're not a member of", async () => {
    const result = await service.recordView({
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
    expect(row.metadata).toEqual({
      kind: "team",
      workspaceLabel: `Shared ${suffix}`,
    });
  });

  /** @scenario Self-view short-circuit — no audit row for own-workspace or team-member view */
  it("short-circuits self-views (own personal workspace) without writing a row", async () => {
    const before = await prisma.auditLog.count({
      where: {
        userId: VICTIM_ID,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
      },
    });
    const result = await service.recordView({
      actorUserId: VICTIM_ID,
      organizationId: ORG_ID,
      targetTeamId: PERSONAL_TEAM_ID,
      kind: "personal",
    });
    expect(result.recorded).toBe(false);
    expect(result.auditLogId).toBeNull();
    const after = await prisma.auditLog.count({
      where: {
        userId: VICTIM_ID,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
      },
    });
    expect(after).toBe(before);
  });

  it("short-circuits team-member self-views without writing a row", async () => {
    const before = await prisma.auditLog.count({
      where: {
        userId: TEAM_MEMBER_ID,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
      },
    });
    const result = await service.recordView({
      actorUserId: TEAM_MEMBER_ID,
      organizationId: ORG_ID,
      targetTeamId: SHARED_TEAM_ID,
      kind: "team",
    });
    expect(result.recorded).toBe(false);
    const after = await prisma.auditLog.count({
      where: {
        userId: TEAM_MEMBER_ID,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
      },
    });
    expect(after).toBe(before);
  });

  it("rejects cross-org drill-in attempt — silent no-op (no enumeration leak)", async () => {
    // Admin in OUR org; team in a foreign org. The service must NOT
    // confirm the team exists by writing an audit row + must NOT
    // throw a different error than the not-found path. Both 'wrong
    // org' and 'doesn't exist' collapse to recorded=false.
    const foreignOrgId = `org-awva-foreign-${suffix}`;
    const foreignTeamId = `team-awva-foreign-${suffix}`;
    await prisma.organization.create({
      data: {
        id: foreignOrgId,
        name: `Foreign ${suffix}`,
        slug: `awva-foreign-${suffix}`,
      },
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
      const result = await service.recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: foreignTeamId,
        kind: "team",
      });
      expect(result.recorded).toBe(false);
      expect(result.auditLogId).toBeNull();

      // And the same shape if the team simply doesn't exist:
      const phantom = await service.recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: `team-phantom-${suffix}`,
        kind: "team",
      });
      expect(phantom.recorded).toBe(false);
      expect(phantom.auditLogId).toBeNull();
    } finally {
      await prisma.team
        .deleteMany({ where: { id: foreignTeamId } })
        .catch(() => undefined);
      await prisma.organization
        .deleteMany({ where: { id: foreignOrgId } })
        .catch(() => undefined);
    }
  });

  it("emits OCSF mirror row keyed by audit-log id", async () => {
    ocsfStub.insertEvent = vi.fn(async () => undefined) as never;
    // Pick a fresh tuple so the dedup window doesn't suppress.
    const freshTeamId = `team-awva-fresh-${suffix}`;
    const freshUserId = `usr-awva-fresh-${suffix}`;
    await prisma.user.create({
      data: { id: freshUserId, email: `awva-fresh-${suffix}@example.com`, name: "Fresh" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: freshUserId, role: "MEMBER" },
    });
    await prisma.team.create({
      data: {
        id: freshTeamId,
        name: `Fresh personal ${suffix}`,
        slug: `awva-fresh-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: freshUserId,
      },
    });

    try {
      const result = await service.recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: freshTeamId,
        kind: "personal",
      });
      expect(result.recorded).toBe(true);
      // OCSF mirror called once with the right shape.
      expect(ocsfStub.insertEvent).toHaveBeenCalledTimes(1);
      const ocsfArg = (ocsfStub.insertEvent as ReturnType<typeof vi.fn>).mock
        .calls[0]![0];
      expect(ocsfArg.eventId).toBe(result.auditLogId);
      expect(ocsfArg.actorUserId).toBe(ADMIN_ID);
      expect(ocsfArg.actionName).toBe(ADMIN_WORKSPACE_VIEW_ACTION);
      expect(ocsfArg.sourceId).toBe(freshTeamId);
      expect(ocsfArg.sourceType).toBe("personal_workspace");
    } finally {
      await prisma.team.deleteMany({ where: { id: freshTeamId } });
      await prisma.organizationUser.deleteMany({
        where: { userId: freshUserId, organizationId: ORG_ID },
      });
      await prisma.user.deleteMany({ where: { id: freshUserId } });
    }
  });

  it("OCSF mirror failure does not fail the AuditLog write", async () => {
    ocsfStub.insertEvent = vi.fn(async () => {
      throw new Error("clickhouse explode");
    }) as never;
    const freshTeamId = `team-awva-ocsf-fail-${suffix}`;
    const freshUserId = `usr-awva-ocsf-fail-${suffix}`;
    await prisma.user.create({
      data: { id: freshUserId, email: `awva-ocsf-${suffix}@example.com`, name: "OcsfFail" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: freshUserId, role: "MEMBER" },
    });
    await prisma.team.create({
      data: {
        id: freshTeamId,
        name: `OcsfFail personal ${suffix}`,
        slug: `awva-ocsf-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: freshUserId,
      },
    });
    try {
      const result = await service.recordView({
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        targetTeamId: freshTeamId,
        kind: "personal",
      });
      // SOC2 contract: AuditLog row IS written even though OCSF failed.
      expect(result.recorded).toBe(true);
      expect(result.auditLogId).toBeTruthy();
      const row = await prisma.auditLog.findUnique({
        where: { id: result.auditLogId! },
      });
      expect(row).not.toBeNull();
    } finally {
      await prisma.team.deleteMany({ where: { id: freshTeamId } });
      await prisma.organizationUser.deleteMany({
        where: { userId: freshUserId, organizationId: ORG_ID },
      });
      await prisma.user.deleteMany({ where: { id: freshUserId } });
    }
  });
});
