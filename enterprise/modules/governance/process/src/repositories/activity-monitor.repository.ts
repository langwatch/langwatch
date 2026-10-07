// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  ActivityEventDetailRow,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
} from "@langwatch/enterprise-governance-contract";

import type { DepartmentDirectory, SourceTeam } from "../rules/activity-monitor-spend.rules.ts";

/** Open anomaly alerts counted per severity. */
export type AnomalyBreakdown = { critical: number; warning: number; info: number };

/** One table's event counts since 24h, 7d and 30d ago, and its newest event (0 when none). */
export type SourceEventWindows = { c24: number; c7: number; c30: number; lastMs: number };

/** A source's events stored outside trace: governance's pulled OCSF rows and pushed log records. */
type SourceEventsScope = { organizationId: string; tenantId: string };

/**
 * The activity monitor's own state: Postgres rows (sources, anomalies, departments) and the
 * pulled and logged events in ClickHouse. Trace spend is read through TraceApi by the service.
 */
export interface ActivityMonitorRepository {
  sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): Promise<{
    health: "healthy" | "unhealthy";
    consecutiveFailures: number;
    lastSuccessfulPullIso: string | null;
    days: { dayStartIso: string; covered: boolean }[];
  }>;
  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]>;
  getOpenAnomalyBreakdown(input: { organizationId: string }): Promise<AnomalyBreakdown>;
  /** The organisation's live projects, members' departments and active department names. */
  getDepartmentDirectory(input: { organizationId: string }): Promise<DepartmentDirectory>;
  findSourceTeams(input: {
    organizationId: string;
    sourceIds: readonly string[];
  }): Promise<{ sourceId: string; team: SourceTeam }[]>;
  /** Unarchived sources by name; `eventsLast24h` is the caller's to count. */
  findActiveSources(input: {
    organizationId: string;
  }): Promise<Omit<IngestionSourceHealthRow, "eventsLast24h">[]>;
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
