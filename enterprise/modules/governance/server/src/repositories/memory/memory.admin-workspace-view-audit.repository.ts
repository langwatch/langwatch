// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AdminWorkspaceViewAuditRepository,
  type AdminWorkspaceAuditRow,
  type AdminWorkspaceTarget,
} from "../audit/admin-workspace-view-audit.repository.ts";

let sequence = 0;

/**
 * The admin-workspace-view-audit twin: targets are seeded by the test, rows
 * accumulate in an array, "recent" reads by the same fields the query filters.
 */
export class MemoryAdminWorkspaceViewAuditRepository extends AdminWorkspaceViewAuditRepository {
  private readonly targets = new Map<string, AdminWorkspaceTarget>();
  private readonly rows: Array<{
    actorUserId: string;
    targetKind: string;
    targetId: string;
    createdAtMs: number;
    row: AdminWorkspaceAuditRow;
  }> = [];

  static create(): MemoryAdminWorkspaceViewAuditRepository {
    return new MemoryAdminWorkspaceViewAuditRepository();
  }

  seedTarget(teamId: string, target: AdminWorkspaceTarget): void {
    this.targets.set(teamId, target);
  }

  async findTarget(input: {
    teamId: string;
    actorUserId: string;
  }): Promise<AdminWorkspaceTarget | null> {
    return this.targets.get(input.teamId) ?? null;
  }

  async findRecent(input: {
    actorUserId: string;
    targetKind: string;
    targetId: string;
    sinceMs: number;
  }): Promise<boolean> {
    return this.rows.some(
      (entry) =>
        entry.actorUserId === input.actorUserId &&
        entry.targetKind === input.targetKind &&
        entry.targetId === input.targetId &&
        entry.createdAtMs >= input.sinceMs,
    );
  }

  async create(input: {
    actorUserId: string;
    organizationId: string;
    targetKind: string;
    targetId: string;
    metadata: unknown;
  }): Promise<AdminWorkspaceAuditRow> {
    sequence += 1;
    const row: AdminWorkspaceAuditRow = { id: `audit-${sequence}`, createdAtMs: Date.now() };
    this.rows.push({
      actorUserId: input.actorUserId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      createdAtMs: row.createdAtMs,
      row,
    });
    return row;
  }
}
