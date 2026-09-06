import type { RecordAuditLogCommand } from "./audit-log.commands.ts";

export abstract class AuditLogService {
  abstract record(command: RecordAuditLogCommand): Promise<void>;
}
