// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A connection's history, as either surface reads it (ADR-117 SS5, D04).
 *
 * The organization's own authentication page and the back office both read
 * through this one service: the words are the same regardless of who is
 * looking, because the events are the same events. What differs between the
 * two callers is who may reach this service at all (the router's job) and
 * which organization the read is scoped to (the org router already knows
 * its own; the back office resolves it first — see
 * `SsoConnectionBackofficeService.getHistory`).
 */
import type { SsoConnectionHistoryEntry } from "@ee/sso/sso-connection-event-log.repository";
import { ssoConnectionHistoryCopy } from "./sso-connection-history-copy";

/** How many entries a history panel shows. A connection's lifetime carries a
 *  few dozen facts at most — this is headroom, not a page size a reader will
 *  ever need to click past. */
export const SSO_CONNECTION_HISTORY_LIMIT = 200;

/** One line of the history, as either surface renders it. */
export interface SsoConnectionHistoryEntryView {
  /** The event this line IS, so a re-render cannot reorder or duplicate it. */
  eventId: string;
  occurredAtMs: number;
  summary: string;
  /** True when the grandfather migration produced this fact from an
   *  existing legacy configuration, rather than a human acting on this
   *  connection. */
  carriedOver: boolean;
}

export interface SsoConnectionHistoryReadsPort {
  findHistory(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly SsoConnectionHistoryEntry[]>;
}

export class SsoConnectionHistoryService {
  constructor(
    private readonly deps: { history: SsoConnectionHistoryReadsPort },
  ) {}

  /**
   * What happened to one connection, newest first.
   *
   * Organization-scoped the way every other read in this feature area is,
   * and structurally so: the log is scanned in this organization's tenant,
   * so another organization's connection is not filtered out — it is never
   * found, which is the same answer a connection that does not exist gets.
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
    const entries = await this.deps.history.findHistory({
      organizationId,
      connectionId,
      limit,
    });
    return entries.map(toHistoryView);
  }
}

function toHistoryView(
  entry: SsoConnectionHistoryEntry,
): SsoConnectionHistoryEntryView {
  return {
    eventId: entry.eventId,
    occurredAtMs: entry.occurredAtMs,
    summary: ssoConnectionHistoryCopy(entry),
    carriedOver: entry.source === "legacy-grandfathered",
  };
}
