import { z } from "zod";
import { auditLogEntrySchema } from "./audit-log.ts";

export const recordAuditLogCommandSchema = auditLogEntrySchema;
export type RecordAuditLogCommand = z.infer<typeof recordAuditLogCommandSchema>;
