import type { RecordAuditLogCommand } from "./audit-log.commands";

export abstract class AuditLogService {
  abstract record(command: RecordAuditLogCommand): Promise<void>;
}
