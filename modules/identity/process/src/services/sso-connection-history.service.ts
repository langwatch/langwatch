import {
  SSO_CONNECTION_HISTORY_LIMIT,
  type SsoConnectionHistoryEntryView,
} from "@langwatch/identity-contract";

import type {
  SsoConnectionHistoryEntry,
  SsoConnectionHistoryRepository,
} from "../repositories/sso-connection-history.repository.ts";
import { ssoConnectionHistoryCopy } from "../rules/sso-connection-history-copy.rules.ts";

/**
 * A connection's history, as either surface reads it (ADR-117 §5, D04). The
 * authentication page and the back office read through this one service,
 * because the events are the same events.
 */
export class SsoConnectionHistoryService {
  static create(deps: { history: SsoConnectionHistoryRepository }): SsoConnectionHistoryService {
    return new SsoConnectionHistoryService(deps.history);
  }

  private constructor(private readonly history: SsoConnectionHistoryRepository) {}

  /**
   * What happened to one connection, newest first. Organization-scoped
   * structurally: the log is scanned in this organization's tenant, so
   * another organization's connection is never found rather than filtered.
   */
  async getHistory({
    organizationId,
    connectionId,
    limit = SSO_CONNECTION_HISTORY_LIMIT,
  }: {
    organizationId: string;
    connectionId: string;
    limit?: number;
  }): Promise<SsoConnectionHistoryEntryView[]> {
    const entries = await this.history.findHistory({ organizationId, connectionId, limit });
    return entries.map(toHistoryView);
  }
}

function toHistoryView(entry: SsoConnectionHistoryEntry): SsoConnectionHistoryEntryView {
  return {
    eventId: entry.eventId,
    occurredAtMs: entry.occurredAtMs,
    summary: ssoConnectionHistoryCopy(entry),
    carriedOver: entry.source === "legacy-grandfathered",
  };
}
