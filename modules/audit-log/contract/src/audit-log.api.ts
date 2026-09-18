import { moduleApi } from "@langwatch/kernel/module-api";

import type { RecordAuditLogCommand } from "./audit-log.commands.ts";
import type { AuditLogHistoryEntry, ListAuditLogEntityHistoryInput } from "./audit-log.ts";

/** Portable audit write capability. */
export interface AuditLogApi {
  record(command: RecordAuditLogCommand): Promise<void>;
  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
}

export const AuditLogApi = moduleApi<AuditLogApi>()("audit-log");
