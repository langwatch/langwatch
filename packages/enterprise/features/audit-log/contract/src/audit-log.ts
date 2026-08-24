import { z } from "zod";

export const AUDIT_LOG_FEATURE_ID = "audit-log" as const;

export const auditLogJsonValueSchema = z.json();
export type AuditLogJsonValue = z.infer<typeof auditLogJsonValueSchema>;

export const auditLogEntrySchema = z.object({
  userId: z.string().min(1),
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
