import { moduleApi } from "@langwatch/kernel/module-api";

import type { RecordAuditLogCommand } from "./audit-log.commands.ts";
import type {
  AuditLogHistoryEntry,
  ListAuditLogEntityHistoryInput,
  RecordedAuditLogEntry,
  RecordedSinceInput,
} from "./audit-log.ts";

/** Portable audit write capability. */
export interface AuditLogApi {
  record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry>;
  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
  /** Whether this actor already recorded this action on this target since `sinceMs`. */
  hasRecordedSince(input: RecordedSinceInput): Promise<boolean>;
}

export const AuditLogApi = moduleApi<AuditLogApi>()("audit-log");
