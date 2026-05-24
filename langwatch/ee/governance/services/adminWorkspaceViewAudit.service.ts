// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * AdminWorkspaceViewAuditService — records audit-log + OCSF rows
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
 * floods the audit log with no forensic signal — collapsing the
 * burst to ONE row per (admin, target, kind, 5-min window) is
 * sufficient for both SOC2 evidence + admin self-discovery on
 * /me/configure → Activity.
 *
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 *       specs/ai-gateway/governance/ingestion-attribution.feature
 *         §"Admins read user-scoped traces ONLY via audit-logged drill-in"
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "./governanceOcsfEvents.clickhouse.repository";
import { ensureHiddenGovernanceProject } from "./governanceProject.service";

import { createLogger } from "~/utils/logger/server";

const logger = createLogger(
  "langwatch:governance:admin-workspace-view-audit",
);

/** Action name pinned by the spec — DO NOT rename without amending the spec. */
export const ADMIN_WORKSPACE_VIEW_ACTION = "governance.viewWorkspaceAs" as const;

/**
 * Dedup window. Within this many milliseconds, repeat detections
 * of the same (admin, target, kind) tuple collapse to one audit
 * row. Tuned to outlast a typical multi-tab drill-in burst (admin
 * opens Traces, Datasets, Sessions in quick succession on the
 * same target) but short enough that a re-visit ten minutes later
 * fires a fresh row — distinct viewing sessions get distinct
 * forensic markers.
 */
export const ADMIN_WORKSPACE_VIEW_DEDUP_MS = 5 * 60 * 1000;

export type AdminWorkspaceKind = "personal" | "team";

export interface RecordWorkspaceViewInput {
  /** The drilling-in admin (caller). */
  actorUserId: string;
  /** Org context — the workspace must live under this org. */
  organizationId: string;
  /** Target Team.id. For personal workspaces, the user's personal team. */
  targetTeamId: string;
  /** Discriminator surfaced in metadata + drives the OCSF target name. */
  kind: AdminWorkspaceKind;
  /**
   * Optional human-readable label to record alongside the IDs
   * (e.g. team name) so the audit row reads naturally without a
   * lookup. Truncated to 256 chars defensively.
   */
  workspaceLabel?: string;
}

export interface AdminWorkspaceViewAuditDeps {
  prisma: PrismaClient;
  ocsfRepository?: GovernanceOcsfEventsClickHouseRepository;
}

export class AdminWorkspaceViewAuditService {
  constructor(private readonly deps: AdminWorkspaceViewAuditDeps) {}

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
   * row is written — the layout-level detection already filters
   * those, but the service double-checks at the auth boundary
   * so a malicious caller can't synthesize phantom audit rows
   * by claiming to view their own workspace.
   */
  async recordView(input: RecordWorkspaceViewInput): Promise<{
    recorded: boolean;
    auditLogId: string | null;
  }> {
    const team = await this.deps.prisma.team.findUnique({
      where: { id: input.targetTeamId },
      select: {
        id: true,
        organizationId: true,
        ownerUserId: true,
        isPersonal: true,
        name: true,
        members: {
          where: { userId: input.actorUserId },
          select: { userId: true },
        },
      },
    });
    if (!team) {
      // Non-existent team. Don't leak the distinction between
      // "wrong org" and "doesn't exist" — silently no-op.
      return { recorded: false, auditLogId: null };
    }
    if (team.organizationId !== input.organizationId) {
      // Cross-org probe. No audit row, no error surface.
      return { recorded: false, auditLogId: null };
    }

    const isOwner =
      team.isPersonal && team.ownerUserId === input.actorUserId;
    const isMember = team.members.length > 0;
    if (isOwner || isMember) {
      // Self-view (own personal workspace) or team-member view
      // (own team workspace). Not a privileged drill-in — no
      // audit row needed.
      return { recorded: false, auditLogId: null };
    }

    const since = new Date(Date.now() - ADMIN_WORKSPACE_VIEW_DEDUP_MS);
    const recent = await this.deps.prisma.auditLog.findFirst({
      where: {
        userId: input.actorUserId,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
        targetKind: dedupTargetKind(input.kind),
        targetId: input.targetTeamId,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) {
      return { recorded: false, auditLogId: null };
    }

    const label = (input.workspaceLabel ?? team.name ?? "").slice(0, 256);
    const metadata: Prisma.InputJsonValue = {
      kind: input.kind,
      workspaceLabel: label,
    };

    const row = await this.deps.prisma.auditLog.create({
      data: {
        userId: input.actorUserId,
        organizationId: input.organizationId,
        action: ADMIN_WORKSPACE_VIEW_ACTION,
        targetKind: dedupTargetKind(input.kind),
        targetId: input.targetTeamId,
        metadata,
        // before/after intentionally omitted — this is a read,
        // not a state-change. The metadata captures the read
        // shape (kind + label) without misusing the diff fields.
      },
      select: { id: true, createdAt: true },
    });

    // Best-effort OCSF mirror so SIEM consumers see the same
    // event without polling the AuditLog table. Failures here
    // are logged but don't fail the AuditLog write — the SOC2
    // contract is satisfied as long as the AuditLog row landed.
    if (this.deps.ocsfRepository) {
      try {
        const govProject = await ensureHiddenGovernanceProject(
          this.deps.prisma,
          input.organizationId,
        );
        await this.deps.ocsfRepository.insertEvent({
          tenantId: govProject.id,
          eventId: row.id,
          traceId: "",
          sourceId: input.targetTeamId,
          sourceType: input.kind === "personal" ? "personal_workspace" : "team_workspace",
          activityId: OCSF_ACTIVITY.READ,
          severityId: OCSF_SEVERITY.INFO,
          eventTime: row.createdAt,
          actorUserId: input.actorUserId,
          actorEmail: "",
          actorEnduserId: "",
          actionName: ADMIN_WORKSPACE_VIEW_ACTION,
          targetName: label || input.targetTeamId,
          anomalyAlertId: "",
          rawOcsfJson: JSON.stringify({
            action: ADMIN_WORKSPACE_VIEW_ACTION,
            actor: { user_uid: input.actorUserId },
            target: {
              uid: input.targetTeamId,
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
            targetTeamId: input.targetTeamId,
            error,
          },
          "OCSF mirror for admin workspace view failed — AuditLog row already written",
        );
      }
    }

    return { recorded: true, auditLogId: row.id };
  }
}

/**
 * Stable mapping from the public `kind` discriminator to the
 * `AuditLog.targetKind` string we filter on for dedup. Kept as
 * a function (not inline literals) so a future taxonomy change
 * touches one place.
 */
function dedupTargetKind(kind: AdminWorkspaceKind): string {
  return kind === "personal" ? "personal_workspace" : "team_workspace";
}
