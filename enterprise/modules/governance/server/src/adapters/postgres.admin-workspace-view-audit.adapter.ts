import type { ProjectApi } from "@langwatch/project-contract";
import type { AdminWorkspaceViewOcsfPort } from "../ports/admin-workspace-view-audit.port.ts";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port.ts";
import {
  PrismaAdminWorkspaceViewAuditRepository,
  type AdminWorkspaceViewAuditDatabase,
} from "../repositories/prisma/prisma.admin-workspace-view-audit.repository.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../services/admin-workspace-view-audit.service.ts";

export class PostgresAdminWorkspaceViewAuditAdapter {
  private constructor(
    private readonly options: {
      database: AdminWorkspaceViewAuditDatabase;
      projects?: ProjectApi;
      ocsf?: AdminWorkspaceViewOcsfPort;
      diagnostics?: GovernanceDiagnosticsPort;
      clock?: () => number;
    },
  ) {}

  static create(options: {
    database: AdminWorkspaceViewAuditDatabase;
    projects?: ProjectApi;
    ocsf?: AdminWorkspaceViewOcsfPort;
    diagnostics?: GovernanceDiagnosticsPort;
    clock?: () => number;
  }): PostgresAdminWorkspaceViewAuditAdapter {
    return new PostgresAdminWorkspaceViewAuditAdapter(options);
  }

  build(): DefaultGovernanceAdminWorkspaceViewAuditService {
    return DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository: PrismaAdminWorkspaceViewAuditRepository.create(this.options.database),
      projects: this.options.projects,
      ocsf: this.options.ocsf,
      diagnostics: this.options.diagnostics,
      clock: this.options.clock,
    });
  }
}
