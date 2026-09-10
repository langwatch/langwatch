import type { Instant } from "@langwatch/time";

export interface AuthzAuditRow {
  id: string;
  createdAt: Instant;
  userId: string | null;
  organizationId: string;
  action: string;
  metadata: Record<string, unknown>;
}

/** Insert is idempotent by row ID and never updates an existing audit fact. */
export abstract class AuthzAuditTrailStore {
  abstract insert(row: AuthzAuditRow): Promise<void>;
}
