import type { AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type { Instant } from "@langwatch/time";

/** One audit row as the recent-items strip reads it: what was done, to what, and when. */
export type RecentTouch = {
  action: string;
  args: AuditLogJsonValue;
  createdAt: Instant;
};

export type FindRecentTouchesInput = {
  userId: string;
  projectId: string;
  actionPrefixes: readonly string[];
  limit: number;
};

/** One person's own audit rows in a project, newest first, narrowed to the given families. */
export interface RecentTouchRepository {
  findRecentTouches(input: FindRecentTouchesInput): Promise<RecentTouch[]>;
}
