import type { AdminWorkspaceKind } from "@langwatch/enterprise-governance-contract";

export type AdminWorkspaceAuditRow = {
  id: string;
  createdAtMs: number;
};

export abstract class AdminWorkspaceViewAuditRepository {
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
