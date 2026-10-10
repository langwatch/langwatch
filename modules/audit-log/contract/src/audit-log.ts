import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

export const AUDIT_LOG_FEATURE_ID = "audit-log" as const;

export const auditLogJsonValueSchema = z.json();
export type AuditLogJsonValue = z.infer<typeof auditLogJsonValueSchema>;

const auditLogEntrySchemaDefinition = z.object({
  /** Whoever did it, when the log knows. Absent on a row about an actor
   *  nobody has identified — a lock taken against an address with no account
   *  is precisely the row an attack shows up in, and it still gets appended. */
  userId: z.string().min(1).optional(),
  /** Who really did it when that is not `userId`, e.g. whoever sent an accepted invite. */
  actorUserId: z.string().min(1).optional(),
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
  /** The target's state either side of a change, as the governance trail shows it. */
  before: auditLogJsonValueSchema.optional(),
  after: auditLogJsonValueSchema.optional(),
});
export interface AuditLogEntrySchema extends Named<typeof auditLogEntrySchemaDefinition> {}
export const auditLogEntrySchema: AuditLogEntrySchema = auditLogEntrySchemaDefinition;

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

const auditLogHistoryEntrySchemaDefinition = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  action: z.string(),
  createdAt: z.date(),
  args: auditLogJsonValueSchema,
});
export interface AuditLogHistoryEntrySchema extends Named<
  typeof auditLogHistoryEntrySchemaDefinition
> {}
export const auditLogHistoryEntrySchema: AuditLogHistoryEntrySchema =
  auditLogHistoryEntrySchemaDefinition;

export type AuditLogHistoryEntry = z.infer<typeof auditLogHistoryEntrySchema>;

export type ListAuditLogEntityHistoryInput = {
  projectId: string;
  actionPrefix: string;
  entityId: string;
  argumentNames: string[];
  limit: number;
};

/** One trail's read: the newest entries recorded under a target kind (Alex, 2026-10-07, CD-3). */
const findAuditLogByTargetKindInputSchemaDefinition = z
  .object({ targetKind: z.string().min(1), limit: z.number().int().positive() })
  .strict();
export interface FindAuditLogByTargetKindInputSchema extends Named<
  typeof findAuditLogByTargetKindInputSchemaDefinition
> {}
export const findAuditLogByTargetKindInputSchema: FindAuditLogByTargetKindInputSchema =
  findAuditLogByTargetKindInputSchemaDefinition;
export type FindAuditLogByTargetKindInput = z.infer<typeof findAuditLogByTargetKindInputSchema>;

const auditLogTargetEntrySchemaDefinition = z.object({
  id: z.string(),
  createdAt: z.date(),
  action: z.string(),
  targetId: z.string().nullable(),
  projectId: z.string().nullable(),
  userId: z.string().nullable(),
  metadata: auditLogJsonValueSchema,
});
export interface AuditLogTargetEntrySchema extends Named<
  typeof auditLogTargetEntrySchemaDefinition
> {}
export const auditLogTargetEntrySchema: AuditLogTargetEntrySchema =
  auditLogTargetEntrySchemaDefinition;
export type AuditLogTargetEntry = z.infer<typeof auditLogTargetEntrySchema>;

/** Portable audit write capability. */
export interface AuditLogApi {
  record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry>;
  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
  /** Newest first, at most `limit`; a kind nothing was recorded under lists nothing. */
  findByTargetKind(input: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]>;
  /** Whether this actor already recorded this action on this target since `sinceMs`. */
  hasRecordedSince(input: RecordedSinceInput): Promise<boolean>;
}

export const AuditLogApi = moduleApi<AuditLogApi>()("audit-log");

/**
 * `idempotencyKey` is an `audit` KSUID the producer mints once, in the commit that records the
 * intent; the row stores it in its own unique column, so a repeat delivery writes nothing and
 * answers the first row (Alex, Q72; audit R2). The row's id stays the table's own.
 */
const recordAuditLogCommandSchemaDefinition = z.object({
  ...auditLogEntrySchema.shape,
  idempotencyKey: z.string().min(1).optional(),
});
export interface RecordAuditLogCommandSchema extends Named<
  typeof recordAuditLogCommandSchemaDefinition
> {}
export const recordAuditLogCommandSchema: RecordAuditLogCommandSchema =
  recordAuditLogCommandSchemaDefinition;
export type RecordAuditLogCommand = z.infer<typeof recordAuditLogCommandSchema>;

/** The payload of a producer's audit intent: an entry its outbox records after commit. */
const auditLogIntentSchemaDefinition = recordAuditLogCommandSchema.required({
  idempotencyKey: true,
});
export interface AuditLogIntentSchema extends Named<typeof auditLogIntentSchemaDefinition> {}
export const auditLogIntentSchema: AuditLogIntentSchema = auditLogIntentSchemaDefinition;
export type AuditLogIntent = z.infer<typeof auditLogIntentSchema>;
