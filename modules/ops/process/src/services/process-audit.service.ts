import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { ProcessAuditEntryView } from "@langwatch/ops-contract";
import { z } from "zod";

import type {
  ProcessAuditRepository,
  ProcessControlAction,
} from "../repositories/ops-audit.repository.ts";

const TARGET_KIND = "process_instance";

const auditMetadataSchema = z.record(z.string(), z.json());

/** Target of an act that names no single instance; the scope is in metadata. */
const FLEET_TARGET_ID = "fleet";

/** Process-manager operator acts: written through the audit log, listed from ops' trail. */
export class ProcessAuditService {
  static create({
    auditLog,
    history,
  }: {
    auditLog: Pick<AuditLogApi, "record">;
    history: ProcessAuditRepository;
  }): ProcessAuditService {
    return new ProcessAuditService(auditLog, history);
  }

  private constructor(
    private readonly auditLog: Pick<AuditLogApi, "record">,
    private readonly history: ProcessAuditRepository,
  ) {}

  async append(entry: {
    actorUserId: string;
    action: ProcessControlAction;
    /** Null for a fleet-scoped act, which belongs to no one process. */
    processName: string | null;
    /** Null for a cross-tenant act; never a placeholder that reads as a real project. */
    projectId: string | null;
    processKey: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // The target triple is written only when all three parts are real: a bulk
    // act with a name but no instance would otherwise read as `foo/null/null`.
    await this.auditLog.record({
      userId: entry.actorUserId,
      ...(entry.projectId === null ? {} : { projectId: entry.projectId }),
      action: entry.action,
      targetKind: TARGET_KIND,
      targetId:
        entry.processName && entry.projectId && entry.processKey
          ? `${entry.processName}/${entry.projectId}/${entry.processKey}`
          : FLEET_TARGET_ID,
      metadata: auditMetadataSchema.parse(entry.metadata ?? {}),
    });
  }

  findRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]> {
    return this.history.findRecent(params);
  }
}
