import type { GetRecentItemsParams } from "../rules/recent-items.rules";

/** A Json column's value, mirroring the generated client's own shape. */
export type AuditLogJsonObject = { [Key in string]?: AuditLogJsonValue };
export type AuditLogJsonArray = AuditLogJsonValue[];
export type AuditLogJsonValue =
  | string
  | number
  | boolean
  | AuditLogJsonObject
  | AuditLogJsonArray
  | null;

/** One audit-trail row, restated so this port names no generated type. */
export type AuditLog = {
  id: string;
  createdAt: Date;
  userId: string | null;
  projectId: string | null;
  organizationId: string | null;
  action: string;
  args: AuditLogJsonValue | null;
  error: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: AuditLogJsonValue | null;
  targetKind: string | null;
  targetId: string | null;
  before: AuditLogJsonValue | null;
  after: AuditLogJsonValue | null;
};

/** The columns the strip needs to render one row and link it. */
type RecentEntityRow = {
  id: string;
  name: string;
  updatedAt: Date;
  projectId: string;
  project: { slug: string };
};

/** A prompt is hidden once it is soft-deleted rather than removed. */
export type RecentPromptRow = RecentEntityRow & { deletedAt: Date | null };

/** Workflows and datasets are hidden once archived. */
export type RecentArchivableRow = RecentEntityRow & { archivedAt: Date | null };

/** Monitors and annotation queues are addressed by slug, not id. */
export type RecentSluggedRow = RecentEntityRow & { slug: string };

/**
 * The audit-trail reads behind the home screen's recent strip, and the five entity lookups that
 * hydrate what it finds there.
 */
export abstract class RecentItemsRepository {
  abstract getRecentAuditLogEntries(params: GetRecentItemsParams): Promise<AuditLog[]>;
  abstract tryGetPromptById(id: string, projectId: string): Promise<RecentPromptRow | null>;
  abstract tryGetWorkflowById(id: string, projectId: string): Promise<RecentArchivableRow | null>;
  abstract tryGetDatasetById(id: string, projectId: string): Promise<RecentArchivableRow | null>;
  abstract tryGetMonitorById(id: string, projectId: string): Promise<RecentSluggedRow | null>;
  abstract tryGetAnnotationQueueById(
    id: string,
    projectId: string,
  ): Promise<RecentSluggedRow | null>;
}
