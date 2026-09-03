import {
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  type AdminWorkspaceKind,
  type RecordWorkspaceViewInput,
  type RecordWorkspaceViewResult,
  recordWorkspaceViewInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectService } from "@langwatch/project-contract";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import type {
  AdminWorkspaceViewAuditRepository,
  AdminWorkspaceViewOcsfPort,
} from "../ports/admin-workspace-view-audit.port";

const skipped = (): RecordWorkspaceViewResult => ({
  recorded: false,
  auditLogId: null,
});

export class DefaultGovernanceAdminWorkspaceViewAuditService {
  private constructor(
    private readonly repository: AdminWorkspaceViewAuditRepository,
    private readonly options: {
      projects?: ProjectService;
      ocsf?: AdminWorkspaceViewOcsfPort;
      diagnostics?: GovernanceDiagnosticsPort;
      clock: () => number;
    },
  ) {}

  static create(options: {
    repository: AdminWorkspaceViewAuditRepository;
    projects?: ProjectService;
    ocsf?: AdminWorkspaceViewOcsfPort;
    diagnostics?: GovernanceDiagnosticsPort;
    clock?: () => number;
  }): DefaultGovernanceAdminWorkspaceViewAuditService {
    return new DefaultGovernanceAdminWorkspaceViewAuditService(options.repository, {
      ...options,
      clock: options.clock ?? Date.now,
    });
  }

  async recordView(input: RecordWorkspaceViewInput): Promise<RecordWorkspaceViewResult> {
    const parsed = recordWorkspaceViewInputSchema.parse(input);
    const team = await this.repository.tryFindTarget({
      teamId: parsed.targetTeamId,
      actorUserId: parsed.actorUserId,
    });
    if (!team || team.organizationId !== parsed.organizationId) return skipped();
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
    if (recent) return skipped();

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
    if (!this.options.ocsf || !this.options.projects) return;
    try {
      const project = await this.options.projects.ensureInternal({
        organizationId: input.organizationId,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });
      await this.options.ocsf.mirror({
        tenantId: project.id,
        auditLogId: row.id,
        createdAtMs: row.createdAtMs,
        view: input,
        label,
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
