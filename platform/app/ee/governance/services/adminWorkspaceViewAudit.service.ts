// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
/**
 * AdminWorkspaceViewAuditService: records audit-log + OCSF rows
 * when an org admin drills into another user's Personal Workspace
 * or a team's Team Workspace from the bird's-eye view.
 *
 * Load-bearing for the SOC2 / ISO27001 invariant: every admin read
 * of user-scoped data is captured in the audit log. Without this,
 * the bird's-eye drill-in becomes a silent surveillance surface.
 *
 * Dedup window: a single drill-in can re-trigger the layout-level
 * detection on every navigation within the same project (route
 * change, page reload, deep-link back). Writing one row per render
 * floods the audit log with no forensic signal: collapsing the
 * burst to ONE row per (admin, target, kind, 5-min window) is
 * sufficient for both SOC2 evidence + admin self-discovery on
 * /me/configure → Activity.
 *
 * An aggregate project (ADR-144) reads other people's projects through
 * shared grants, so every read of one is audited the same way, with kind
 * `aggregate` and the aggregate as the target. The row names neither the
 * member read nor the trace opened.
 *
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 *       specs/ai-gateway/governance/ingestion-attribution.feature
 *         §"Admins read user-scoped traces ONLY via audit-logged drill-in"
 *       specs/governance/aggregate-project.feature, section G
 */
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import {
  type ProjectKindReader,
  projectKindReaderFor,
} from "~/server/app-layer/permissions/aggregate-admin-gate";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";
import {
  type GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "./governanceOcsfEvents.clickhouse.repository";
import { ensureHiddenGovernanceProject } from "./governanceProject.service";

const logger = createLogger("langwatch:governance:admin-workspace-view-audit");

/** Action name pinned by the spec: DO NOT rename without amending the spec. */
export const ADMIN_WORKSPACE_VIEW_ACTION =
  "governance.viewWorkspaceAs" as const;

/**
 * Dedup window. Within this many milliseconds, repeat detections
 * of the same (admin, target, kind) tuple collapse to one audit
 * row. Tuned to outlast a typical multi-tab drill-in burst (admin
 * opens Traces, Datasets, Sessions in quick succession on the
 * same target) but short enough that a re-visit ten minutes later
 * fires a fresh row: distinct viewing sessions get distinct
 * forensic markers.
 */
export const ADMIN_WORKSPACE_VIEW_DEDUP_MS = 5 * 60 * 1000;

export type AdminWorkspaceKind = "personal" | "team" | "aggregate";

/**
 * What was read. A personal or team workspace is a team; an aggregate
 * project (ADR-144) is one project reading its members' traces, so its
 * target is the project itself.
 */
export type RecordWorkspaceViewTarget =
  | {
      kind: "personal" | "team";
      /** Target Team.id. For personal workspaces, the user's personal team. */
      targetTeamId: string;
    }
  | {
      kind: "aggregate";
      /** The aggregate Project.id. Never a member, never a trace. */
      targetProjectId: string;
    };

export type RecordWorkspaceViewInput = RecordWorkspaceViewTarget & {
  /** The drilling-in admin (caller). */
  actorUserId: string;
  /** Org context: the workspace must live under this org. */
  organizationId: string;
  /**
   * Optional human-readable label to record alongside the IDs
   * (e.g. team name) so the audit row reads naturally without a
   * lookup. Truncated to 256 chars defensively.
   */
  workspaceLabel?: string;
};

export interface AdminWorkspaceViewAuditDeps {
  prisma: PrismaClient;
  ocsfRepository?: GovernanceOcsfEventsClickHouseRepository;
  /**
   * How an aggregate target's kind is read: the cached reader the aggregate
   * admin gate uses, the Prisma handle's own by default.
   */
  kinds?: ProjectKindReader;
  /**
   * The clock the dedup window and the row's time are read from. Injectable
   * so a test crosses the window without waiting; the real clock otherwise.
   */
  now?: () => Date;
}

/** The audited target once resolved: its id on the row, and its name. */
type ResolvedTarget = { targetId: string; name: string };

export class AdminWorkspaceViewAuditService {
  private readonly now: () => Date;
  private readonly kinds: ProjectKindReader;

  constructor(private readonly deps: AdminWorkspaceViewAuditDeps) {
    this.now = deps.now ?? (() => new Date());
    this.kinds = deps.kinds ?? projectKindReaderFor(deps.prisma);
  }

  static create(
    deps: AdminWorkspaceViewAuditDeps,
  ): AdminWorkspaceViewAuditService {
    return new AdminWorkspaceViewAuditService(deps);
  }

  /**
   * Idempotent within `ADMIN_WORKSPACE_VIEW_DEDUP_MS`. Returns
   * `{ recorded: true, auditLogId }` on the first call in the
   * window, `{ recorded: false, auditLogId: null }` on subsequent
   * calls. Callers can ignore the result; the dedup is purely
   * for forensic clarity.
   *
   * Self-view short-circuit: if `actorUserId` is the team owner
   * (personal workspace) or a team member (team workspace), no
   * row is written: the layout-level detection already filters
   * those, but the service double-checks at the auth boundary
   * so a malicious caller can't synthesize phantom audit rows
   * by claiming to view their own workspace.
   *
   * An aggregate has no self-view: its admin is always on its team, and
   * every read of it is a read of other people's projects.
   */
  async recordView(input: RecordWorkspaceViewInput): Promise<{
    recorded: boolean;
    auditLogId: string | null;
  }> {
    const target =
      input.kind === "aggregate"
        ? await this.resolveAggregate({
            organizationId: input.organizationId,
            targetProjectId: input.targetProjectId,
          })
        : await this.resolveWorkspace({
            actorUserId: input.actorUserId,
            organizationId: input.organizationId,
            targetTeamId: input.targetTeamId,
          });
    if (!target) return { recorded: false, auditLogId: null };

    const targetKind = dedupTargetKind(input.kind);
    const since = new Date(
      this.now().getTime() - ADMIN_WORKSPACE_VIEW_DEDUP_MS,
    );
    const recent = await this.deps.prisma.auditLog.findFirst({
      where: {
        userId: input.actorUserId,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
        targetKind,
        targetId: target.targetId,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) {
      return { recorded: false, auditLogId: null };
    }

    const label = (input.workspaceLabel ?? target.name ?? "").slice(0, 256);
    const metadata: Prisma.InputJsonValue = {
      kind: input.kind,
      workspaceLabel: label,
    };

    const row = await this.deps.prisma.auditLog.create({
      data: {
        userId: input.actorUserId,
        organizationId: input.organizationId,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
        targetKind,
        targetId: target.targetId,
        metadata,
        createdAt: this.now(),
        // before/after intentionally omitted: this is a read,
        // not a state-change. The metadata captures the read
        // shape (kind + label) without misusing the diff fields.
      },
      select: { id: true, createdAt: true },
    });

    await this.mirrorToOcsf({ input, target, targetKind, label, row });

    return { recorded: true, auditLogId: row.id };
  }

  /**
   * Best-effort OCSF mirror so SIEM consumers see the same event without
   * polling the AuditLog table. Failures here are logged but don't fail the
   * AuditLog write: the SOC2 contract is satisfied once that row landed.
   */
  private async mirrorToOcsf({
    input,
    target,
    targetKind,
    label,
    row,
  }: {
    input: RecordWorkspaceViewInput;
    target: ResolvedTarget;
    targetKind: string;
    label: string;
    row: { id: string; createdAt: Date };
  }): Promise<void> {
    if (!this.deps.ocsfRepository) return;
    try {
      const govProject = await ensureHiddenGovernanceProject(
        this.deps.prisma,
        input.organizationId,
      );
      await this.deps.ocsfRepository.insertEvent({
        tenantId: govProject.id,
        eventId: row.id,
        traceId: "",
        sourceId: target.targetId,
        sourceType: targetKind,
        activityId: OCSF_ACTIVITY.READ,
        severityId: OCSF_SEVERITY.INFO,
        eventTime: row.createdAt,
        actorUserId: input.actorUserId,
        actorEmail: "",
        actorEnduserId: "",
        actionName: ADMIN_WORKSPACE_VIEW_ACTION,
        targetName: label || target.targetId,
        anomalyAlertId: "",
        rawOcsfJson: JSON.stringify({
          action: ADMIN_WORKSPACE_VIEW_ACTION,
          actor: { user_uid: input.actorUserId },
          target: {
            uid: target.targetId,
            name: label,
            type: input.kind,
          },
          organization_id: input.organizationId,
        }),
      });
    } catch (error) {
      logger.warn(
        {
          actorUserId: input.actorUserId,
          targetId: target.targetId,
          error,
        },
        "OCSF mirror for admin workspace view failed: AuditLog row already written",
      );
    }
  }

  /**
   * The personal or team workspace being drilled into, or null when no row
   * should be written: a missing team and a foreign one answer alike, so the
   * distinction never leaks, and a self-view is not a privileged read.
   */
  private async resolveWorkspace({
    actorUserId,
    organizationId,
    targetTeamId,
  }: {
    actorUserId: string;
    organizationId: string;
    targetTeamId: string;
  }): Promise<ResolvedTarget | null> {
    const team = await this.deps.prisma.team.findUnique({
      where: { id: targetTeamId },
      select: {
        id: true,
        organizationId: true,
        ownerUserId: true,
        isPersonal: true,
        name: true,
        members: {
          where: { userId: actorUserId },
          select: { userId: true },
        },
      },
    });
    // Non-existent team or a cross-org probe: no audit row, no error
    // surface, and no way to tell the two apart.
    if (!team || team.organizationId !== organizationId) return null;

    const isOwner = team.isPersonal && team.ownerUserId === actorUserId;
    const isMember = team.members.length > 0;
    // Self-view (own personal workspace) or team-member view (own team
    // workspace). Not a privileged drill-in: no audit row needed.
    if (isOwner || isMember) return null;

    return { targetId: team.id, name: team.name };
  }

  /**
   * The aggregate project being read, or null when it is missing, is not an
   * aggregate, or lives in another organisation; all three answer alike.
   */
  private async resolveAggregate({
    organizationId,
    targetProjectId,
  }: {
    organizationId: string;
    targetProjectId: string;
  }): Promise<ResolvedTarget | null> {
    const kind = await this.kinds.kindOf(targetProjectId);
    if (kind === null || !isAggregateProjectKind(kind)) return null;
    const project = await this.deps.prisma.project.findUnique({
      where: { id: targetProjectId },
      select: {
        id: true,
        name: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project || project.team.organizationId !== organizationId) {
      return null;
    }
    return { targetId: project.id, name: project.name };
  }
}

/**
 * Stable mapping from the public `kind` discriminator to the
 * `AuditLog.targetKind` string we filter on for dedup. Kept as
 * a function (not inline literals) so a future taxonomy change
 * touches one place.
 */
function dedupTargetKind(kind: AdminWorkspaceKind): string {
  return DEDUP_TARGET_KINDS[kind];
}

const DEDUP_TARGET_KINDS: Record<AdminWorkspaceKind, string> = {
  personal: "personal_workspace",
  team: "team_workspace",
  aggregate: "aggregate_project",
};
