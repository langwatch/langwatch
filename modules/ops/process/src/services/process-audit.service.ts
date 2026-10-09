import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { ProcessAuditEntryView } from "@langwatch/ops-contract";
import { z } from "zod";

export type ProcessControlAction =
  | "process_wake_now"
  | "process_redrive_dead_instance"
  | "process_redrive_dead_message"
  | "process_discard_dead_message"
  /** Fleet-scoped acts record a pseudo-ref (`__fleet__`/`__all__`), the same
   *  shape scheduled singletons use for their `__global__` pseudo-project;
   *  the count moved lives in metadata. */
  | "process_redrive_dead_letters"
  | "process_discard_dead_letters"
  | "process_release_lapsed_lease";

const TARGET_KIND = "process_instance";

const auditMetadataSchema = z.record(z.string(), z.json());

/** Target of an act that names no single instance; the scope is in metadata. */
const FLEET_TARGET_ID = "fleet";

/** Process-manager operator acts: written to and listed from the audit log. */
export class ProcessAuditService {
  static create({
    auditLog,
  }: {
    auditLog: Pick<AuditLogApi, "record" | "findByTargetKind">;
  }): ProcessAuditService {
    return new ProcessAuditService(auditLog);
  }

  private constructor(
    private readonly auditLog: Pick<AuditLogApi, "record" | "findByTargetKind">,
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

  async findRecent({ limit }: { limit: number }): Promise<ProcessAuditEntryView[]> {
    const entries = await this.auditLog.findByTargetKind({ targetKind: TARGET_KIND, limit });

    return entries.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt.getTime(),
      action: entry.action,
      targetId: entry.targetId ?? "",
      actorUserId: entry.userId,
      metadata: entry.metadata,
    }));
  }
}
