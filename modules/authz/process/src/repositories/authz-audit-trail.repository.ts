import type { Instant } from "@langwatch/time";

export interface AuthzAuditRow {
  id: string;
  createdAt: Instant;
  userId: string | null;
  organizationId: string;
  action: string;
  metadata: Record<string, unknown>;
  /** The project the entry is filed under: a braid's owner, or the reader of a braided read. */
  projectId?: string;
  /** What the audit log filters the entry by (ADR-183 §8): a braid's entries name it here. */
  targetKind?: string;
  targetId?: string;
}

/** Insert is idempotent by row ID and never updates an existing audit fact. */
export abstract class AuthzAuditTrailRepository {
  abstract insert(row: AuthzAuditRow): Promise<void>;
}
