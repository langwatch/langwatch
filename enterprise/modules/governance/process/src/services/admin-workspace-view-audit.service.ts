import {
  ADMIN_WORKSPACE_VIEW_ACTION,
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  type AdminWorkspaceKind,
  type RecordWorkspaceViewInput,
  type RecordWorkspaceViewResult,
  recordWorkspaceViewInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import {
  type GovernanceDiagnosticsSink,
  type GovernanceOcsfEventWriter,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../app/governance.members.ts";
import type { AdminWorkspaceViewAuditRepository } from "../repositories/admin-workspace-view-audit.repository.ts";

const skipped = (): RecordWorkspaceViewResult => ({
  recorded: false,
  auditLogId: null,
});

export class DefaultGovernanceAdminWorkspaceViewAuditService {
  private constructor(
    private readonly repository: AdminWorkspaceViewAuditRepository,
    private readonly options: {
      projects?: Pick<ProjectApi, "ensureInternal">;
      events?: GovernanceOcsfEventWriter;
      diagnostics?: GovernanceDiagnosticsSink;
      clock: () => number;
    },
  ) {}

  static create(options: {
    repository: AdminWorkspaceViewAuditRepository;
    projects?: Pick<ProjectApi, "ensureInternal">;
    events?: GovernanceOcsfEventWriter;
    diagnostics?: GovernanceDiagnosticsSink;
    clock?: () => number;
  }): DefaultGovernanceAdminWorkspaceViewAuditService {
    return new DefaultGovernanceAdminWorkspaceViewAuditService(options.repository, {
      ...options,
      clock: options.clock ?? Date.now,
    });
  }

  async recordView(input: RecordWorkspaceViewInput): Promise<RecordWorkspaceViewResult> {
    const parsed = recordWorkspaceViewInputSchema.parse(input);
    const team = await this.repository.findTarget({
      teamId: parsed.targetTeamId,
      actorUserId: parsed.actorUserId,
    });
    if (!team || team.organizationId !== parsed.organizationId) {
      return skipped();
    }

    if ((team.isPersonal && team.ownerUserId === parsed.actorUserId) || team.actorIsMember) {
      return skipped();
    }

    const targetKind = this.targetKind(parsed.kind);
    const recent = await this.repository.findRecent({
      actorUserId: parsed.actorUserId,
      targetKind,
      targetId: parsed.targetTeamId,
      sinceMs: this.options.clock() - ADMIN_WORKSPACE_VIEW_DEDUP_MS,
    });
    if (recent) {
      return skipped();
    }

    const label = (parsed.workspaceLabel ?? team.name).slice(0, 256);
    const row = await this.repository.create({
      actorUserId: parsed.actorUserId,
      organizationId: parsed.organizationId,
      targetKind,
      targetId: parsed.targetTeamId,
      metadata: { kind: parsed.kind, workspaceLabel: label },
    });
    await this.mirrorBestEffort(parsed, label, row);

    return { recorded: true, auditLogId: row.id };
  }

  private async mirrorBestEffort(
    input: RecordWorkspaceViewInput,
    label: string,
    row: { id: string; createdAtMs: number },
  ): Promise<void> {
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
        sourceId: input.targetTeamId,
        sourceType: this.targetKind(input.kind),
        activityId: OCSF_ACTIVITY.READ,
        severityId: OCSF_SEVERITY.INFO,
        eventTime: Temporal.Instant.fromEpochMilliseconds(row.createdAtMs),
        actorUserId: input.actorUserId,
        actorEmail: "",
        actorEnduserId: "",
        actionName: ADMIN_WORKSPACE_VIEW_ACTION,
        targetName: label || input.targetTeamId,
        anomalyAlertId: "",
        rawOcsfJson: JSON.stringify({
          action: ADMIN_WORKSPACE_VIEW_ACTION,
          actor: { user_uid: input.actorUserId },
          target: { uid: input.targetTeamId, name: label, type: input.kind },
          organization_id: input.organizationId,
        }),
      });
    } catch (error) {
      this.options.diagnostics?.warn(
        "OCSF mirror for admin workspace view failed — AuditLog row already written",
        {
          actorUserId: input.actorUserId,
          targetTeamId: input.targetTeamId,
          error,
        },
      );
    }
  }

  private targetKind(kind: AdminWorkspaceKind): string {
    return kind === "personal" ? "personal_workspace" : "team_workspace";
  }
}
