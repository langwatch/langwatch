import type {
  AdminWorkspaceKind,
  RecordWorkspaceViewInput,
} from "@langwatch/enterprise-governance-contract";

export type AdminWorkspaceTarget = {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  isPersonal: boolean;
  name: string;
  actorIsMember: boolean;
};

export type AdminWorkspaceAuditRow = {
  id: string;
  createdAtMs: number;
};

export abstract class AdminWorkspaceViewAuditRepository {
  abstract tryFindTarget(input: {
    teamId: string;
    actorUserId: string;
  }): Promise<AdminWorkspaceTarget | null>;

  abstract findRecent(input: {
    actorUserId: string;
    targetKind: string;
    targetId: string;
    sinceMs: number;
  }): Promise<boolean>;

  abstract create(input: {
    actorUserId: string;
    organizationId: string;
    targetKind: string;
    targetId: string;
    metadata: { kind: AdminWorkspaceKind; workspaceLabel: string };
  }): Promise<AdminWorkspaceAuditRow>;
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
