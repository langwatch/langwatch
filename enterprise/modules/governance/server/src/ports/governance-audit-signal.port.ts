import type { GovernanceOcsfExportRow, RecordWorkspaceViewInput } from "@langwatch/enterprise-governance-contract";

/**
 * Folded together from the now-split ocsf-export.port.ts,
 * admin-workspace-view-audit.port.ts and governance-setup-state.port.ts: each
 * remainder, once its repository interface moved to repositories/audit/, fell
 * under the twenty-line fragment-file floor on its own. All three are small
 * read-side signal ports the installation adapter takes as optional
 * infrastructure, so they sit together here rather than as three stubs.
 */
export abstract class GovernanceOcsfEventsReaderPort {
  abstract findAll(input: {
    tenantId: string;
    sinceMs: number;
    sinceEventId: string;
    limit: number;
  }): Promise<GovernanceOcsfExportRow[]>;
}

export abstract class AdminWorkspaceViewOcsfPort {
  abstract mirror(input: {
    tenantId: string;
    auditLogId: string;
    createdAtMs: number;
    view: RecordWorkspaceViewInput;
    label: string;
  }): Promise<void>;
}

export abstract class GovernanceSetupActivityPort {
  abstract hasRecentActivity(input: { tenantId: string; sinceMs: number }): Promise<boolean>;
}
