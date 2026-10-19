import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  ADMIN_WORKSPACE_VIEW_ACTION,
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  type RecordWorkspaceViewInput,
  type RecordWorkspaceViewResult,
  recordWorkspaceViewInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationApi, OrganizationTeam } from "@langwatch/organization-contract";
import {
  isAggregateProjectKind,
  PROJECT_KIND,
  type ProjectApi,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type { GovernanceOcsfEventWriter } from "../repositories/governance.repositories.ts";
import { OCSF_ACTIVITY, OCSF_SEVERITY } from "../rules/ocsf-codes.rules.ts";
import type { GovernanceDiagnosticsSink } from "./governance-policy.service.ts";

type WorkspaceTeams = Pick<OrganizationApi, "getTeam" | "getTeamWithMembers">;
type WorkspaceAuditLog = Pick<AuditLogApi, "record" | "hasRecordedSince">;
/** What an aggregate target is read for: ProjectApi.findWithTeam satisfies it. */
type ViewTarget = Pick<ProjectWithTeam, "id" | "name" | "kind"> & {
  team: Pick<ProjectWithTeam["team"], "organizationId">;
};
type ViewTargets = { findWithTeam(id: string): Promise<ViewTarget | null> };
type ViewKind = RecordWorkspaceViewInput["kind"];

/** The audited target once resolved: its id on the row, and its name. */
type ResolvedTarget = { targetId: string; name: string };

/** The `AuditLog.targetKind` each view kind is deduplicated and filtered under. */
const DEDUP_TARGET_KINDS: Record<ViewKind, string> = {
  personal: "personal_workspace",
  team: "team_workspace",
  aggregate: "aggregate_project",
};

const skipped = (): RecordWorkspaceViewResult => ({
  recorded: false,
  auditLogId: null,
});

type AuditOptions = {
  auditLog: WorkspaceAuditLog;
  teams: WorkspaceTeams;
  targets: ViewTargets;
  projects?: Pick<ProjectApi, "ensureInternal">;
  events?: GovernanceOcsfEventWriter;
  diagnostics?: GovernanceDiagnosticsSink;
  clock: () => number;
};

export class DefaultGovernanceAdminWorkspaceViewAuditService {
  private constructor(private readonly options: AuditOptions) {}

  static create(
    options: Omit<AuditOptions, "clock"> & { clock?: () => number },
  ): DefaultGovernanceAdminWorkspaceViewAuditService {
    return new DefaultGovernanceAdminWorkspaceViewAuditService({
      ...options,
      clock: options.clock ?? Date.now,
    });
  }

  /**
   * One row per actor, target and 5-minute window. `occurredAt` (a fact's own time) replaces the
   * clock for the window, so a redelivered fact finds the row its first delivery wrote.
   * Spec: specs/governance/aggregate-project.feature, section G
   */
  async recordView(
    input: RecordWorkspaceViewInput,
    { occurredAt }: { occurredAt?: number } = {},
  ): Promise<RecordWorkspaceViewResult> {
    const parsed = recordWorkspaceViewInputSchema.parse(input);
    const target =
      parsed.kind === "aggregate"
        ? await this.resolveAggregate({
            organizationId: parsed.organizationId,
            targetProjectId: parsed.targetProjectId,
          })
        : await this.resolveWorkspace({
            actorUserId: parsed.actorUserId,
            organizationId: parsed.organizationId,
            targetTeamId: parsed.targetTeamId,
          });
    if (!target) return skipped();

    const targetKind = DEDUP_TARGET_KINDS[parsed.kind];
    const recent = await this.options.auditLog.hasRecordedSince({
      userId: parsed.actorUserId,
      action: ADMIN_WORKSPACE_VIEW_ACTION,
      targetKind,
      targetId: target.targetId,
      sinceMs: (occurredAt ?? this.options.clock()) - ADMIN_WORKSPACE_VIEW_DEDUP_MS,
    });
    if (recent) return skipped();

    const label = (parsed.workspaceLabel ?? target.name).slice(0, 256);
    const row = await this.options.auditLog.record({
      userId: parsed.actorUserId,
      organizationId: parsed.organizationId,
      action: ADMIN_WORKSPACE_VIEW_ACTION,
      targetKind,
      targetId: target.targetId,
      metadata: { kind: parsed.kind, workspaceLabel: label },
    });
    await this.mirrorBestEffort({ input: parsed, target, targetKind, label, row });

    return { recorded: true, auditLogId: row.id };
  }

  /** A missing and a foreign team answer alike; a self-view or member's view is not privileged. */
  private async resolveWorkspace({
    actorUserId,
    organizationId,
    targetTeamId,
  }: {
    actorUserId: string;
    organizationId: string;
    targetTeamId: string;
  }): Promise<ResolvedTarget | null> {
    const [team] = await this.findTeams({ organizationId, targetTeamId });
    if (!team || team.organizationId !== organizationId) return null;
    if (team.isPersonal && team.ownerUserId === actorUserId) return null;
    if (await this.isMember(team, actorUserId)) return null;
    return { targetId: team.id, name: team.name };
  }

  /** An aggregate of the caller's organisation, or nothing: a missing, plain or foreign project. */
  private async resolveAggregate({
    organizationId,
    targetProjectId,
  }: {
    organizationId: string;
    targetProjectId: string;
  }): Promise<ResolvedTarget | null> {
    const project = await this.options.targets.findWithTeam(targetProjectId);
    if (!project || !isAggregateProjectKind(project.kind)) return null;
    if (project.team.organizationId !== organizationId) return null;
    return { targetId: project.id, name: project.name };
  }

  private async findTeams({
    organizationId,
    targetTeamId,
  }: {
    organizationId: string;
    targetTeamId: string;
  }): Promise<OrganizationTeam[]> {
    try {
      const team = await this.options.teams.getTeam({ organizationId, teamId: targetTeamId });
      return [team];
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "team_not_found") return [];
      throw error;
    }
  }

  private async isMember(team: OrganizationTeam, actorUserId: string): Promise<boolean> {
    const withMembers = await this.options.teams.getTeamWithMembers(
      { organizationId: team.organizationId, slug: team.slug, callerCanManage: true },
      { id: actorUserId },
    );
    return withMembers.members.some((member) => member.userId === actorUserId);
  }

  private async mirrorBestEffort({
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
    row: { id: string; occurredAt: number };
  }): Promise<void> {
    if (!this.options.events || !this.options.projects) {
      return;
    }

    try {
      const project = await this.options.projects.ensureInternal({
        organizationId: input.organizationId,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });
      await this.options.events.insertEvent({
        tenantId: project.id,
        eventId: row.id,
        traceId: "",
        sourceId: target.targetId,
        sourceType: targetKind,
        activityId: OCSF_ACTIVITY.READ,
        severityId: OCSF_SEVERITY.INFO,
        eventTime: Temporal.Instant.fromEpochMilliseconds(row.occurredAt),
        actorUserId: input.actorUserId,
        actorEmail: "",
        actorEnduserId: "",
        actionName: ADMIN_WORKSPACE_VIEW_ACTION,
        targetName: label || target.targetId,
        anomalyAlertId: "",
        rawOcsfJson: JSON.stringify({
          action: ADMIN_WORKSPACE_VIEW_ACTION,
          actor: { user_uid: input.actorUserId },
          target: { uid: target.targetId, name: label, type: input.kind },
          organization_id: input.organizationId,
        }),
      });
    } catch (error) {
      this.options.diagnostics?.warn(
        "OCSF mirror for admin workspace view failed — AuditLog row already written",
        {
          actorUserId: input.actorUserId,
          targetId: target.targetId,
          error,
        },
      );
    }
  }
}
