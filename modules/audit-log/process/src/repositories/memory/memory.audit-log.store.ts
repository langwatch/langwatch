import type { AuditLogEntry } from "@langwatch/audit-log-contract";
import type { Instant } from "@langwatch/time";

export type MemoryAuditLogRow = AuditLogEntry & { id: string; createdAt: Instant };

/** The rows both memory twins share: an entry recorded through one is a touch the other reads. */
export class MemoryAuditLogStore {
  readonly rows: MemoryAuditLogRow[] = [];
}
