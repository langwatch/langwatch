// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ADMIN_WORKSPACE_VIEW_ACTION,
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  type AdminWorkspaceKind,
  type RecordWorkspaceViewInput,
} from "@langwatch/enterprise-governance-contract";
import {
  AdminWorkspaceViewOcsfPort,
  GovernanceDiagnosticsPort,
  PostgresAdminWorkspaceViewAuditAdapter,
  type DefaultGovernanceAdminWorkspaceViewAuditService,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import {
  type GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "./governance-ocsf-events.clickhouse.repository";

const logger = createLogger("langwatch:governance:admin-workspace-view-audit");

export { ADMIN_WORKSPACE_VIEW_ACTION, ADMIN_WORKSPACE_VIEW_DEDUP_MS };
export type { AdminWorkspaceKind, RecordWorkspaceViewInput };

export interface AdminWorkspaceViewAuditDeps {
  prisma: object;
  projects: ProjectService;
  ocsfRepository?: GovernanceOcsfEventsClickHouseRepository;
}

class AppAdminWorkspaceViewDiagnostics extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class AppAdminWorkspaceViewOcsf extends AdminWorkspaceViewOcsfPort {
  constructor(private readonly repository: GovernanceOcsfEventsClickHouseRepository) {
    super();
  }

  async mirror(input: {
    tenantId: string;
    auditLogId: string;
    createdAtMs: number;
    view: RecordWorkspaceViewInput;
    label: string;
  }): Promise<void> {
    await this.repository.insertEvent({
      tenantId: input.tenantId,
      eventId: input.auditLogId,
      traceId: "",
      sourceId: input.view.targetTeamId,
      sourceType:
        input.view.kind === "personal" ? "personal_workspace" : "team_workspace",
      activityId: OCSF_ACTIVITY.READ,
      severityId: OCSF_SEVERITY.INFO,
      eventTime: new Date(input.createdAtMs),
      actorUserId: input.view.actorUserId,
      actorEmail: "",
      actorEnduserId: "",
      actionName: ADMIN_WORKSPACE_VIEW_ACTION,
      targetName: input.label || input.view.targetTeamId,
      anomalyAlertId: "",
      rawOcsfJson: JSON.stringify({
        action: ADMIN_WORKSPACE_VIEW_ACTION,
        actor: { user_uid: input.view.actorUserId },
        target: {
          uid: input.view.targetTeamId,
          name: input.label,
          type: input.view.kind,
        },
        organization_id: input.view.organizationId,
      }),
    });
  }
}

/** App composition adapter for Prisma, OCSF ClickHouse and diagnostics. */
export class AppAdminWorkspaceViewAuditAdapter {
  private constructor(private readonly deps: AdminWorkspaceViewAuditDeps) {}

  static create(deps: AdminWorkspaceViewAuditDeps): AppAdminWorkspaceViewAuditAdapter {
    return new AppAdminWorkspaceViewAuditAdapter(deps);
  }

  build(): DefaultGovernanceAdminWorkspaceViewAuditService {
    return PostgresAdminWorkspaceViewAuditAdapter.create({
      database: this.deps.prisma,
      projects: this.deps.projects,
      ocsf: this.deps.ocsfRepository
        ? new AppAdminWorkspaceViewOcsf(this.deps.ocsfRepository)
        : undefined,
      diagnostics: new AppAdminWorkspaceViewDiagnostics(),
    }).build();
  }
}
