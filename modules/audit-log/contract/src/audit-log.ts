import { z } from "zod";

export const AUDIT_LOG_FEATURE_ID = "audit-log" as const;

export const auditLogJsonValueSchema = z.json();
export type AuditLogJsonValue = z.infer<typeof auditLogJsonValueSchema>;

export const auditLogEntrySchema = z.object({
  /** Whoever did it, when the log knows. Absent on a row about an actor
   *  nobody has identified — a lock taken against an address with no account
   *  is precisely the row an attack shows up in, and it still gets appended. */
  userId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  action: z.string().min(1),
  args: auditLogJsonValueSchema.optional(),
  error: z.string().optional(),
  ipAddress: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  metadata: auditLogJsonValueSchema.optional(),
  targetKind: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** The row a write created; `occurredAt` is epoch milliseconds. */
export type RecordedAuditLogEntry = { id: string; occurredAt: number };

/** Main's workspace-view dedup: one actor's action on one target since a moment. */
export type RecordedSinceInput = {
  userId: string;
  action: string;
  targetKind: string;
  targetId: string;
  sinceMs: number;
};

export const auditLogHistoryEntrySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  action: z.string(),
  createdAt: z.date(),
  args: auditLogJsonValueSchema,
});

export type AuditLogHistoryEntry = z.infer<typeof auditLogHistoryEntrySchema>;

export type ListAuditLogEntityHistoryInput = {
  projectId: string;
  actionPrefix: string;
  entityId: string;
  argumentNames: string[];
  limit: number;
};
