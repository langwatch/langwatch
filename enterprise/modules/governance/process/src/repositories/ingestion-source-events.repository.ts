// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ActivityEventDetailRow } from "@langwatch/enterprise-governance-contract";

/** One table's event counts since 24h, 7d and 30d ago, and its newest event (0 when none). */
export type SourceEventWindows = { c24: number; c7: number; c30: number; lastMs: number };

/** Every read names the organisation and the governance project the events are stored under. */
type SourceEventsScope = { organizationId: string; tenantId: string };

/**
 * A source's events stored outside trace, in ClickHouse: governance's pulled OCSF rows and
 * pushed log records. Trace spend and pushed traces are read through TraceApi by the service.
 */
export interface IngestionSourceEventsRepository {
  countLoggedAndPulledEventsBySource(
    input: SourceEventsScope & { sourceIds: readonly string[]; sinceMs: number },
  ): Promise<{ sourceId: string; count: number }[]>;
  findPulledEventsForSource(
    input: SourceEventsScope & { sourceId: string; beforeMs: number; limit: number },
  ): Promise<ActivityEventDetailRow[]>;
  /** The logged and pulled tables' windows for one source, one entry per table that answered. */
  findLoggedAndPulledEventWindows(
    input: SourceEventsScope & {
      sourceId: string;
      since24h: number;
      since7d: number;
      since30d: number;
    },
  ): Promise<SourceEventWindows[]>;
}
