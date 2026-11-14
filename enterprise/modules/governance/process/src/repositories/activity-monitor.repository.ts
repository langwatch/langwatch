// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  IngestionSourceHealthRow,
  RecentAnomalyRow,
} from "@langwatch/enterprise-governance-contract";

import type {
  DepartmentDirectory,
  SourceTeam,
} from "../features/cost/rules/activity-monitor-spend.rules.ts";

/** Open anomaly alerts counted per severity. */
export type AnomalyBreakdown = { critical: number; warning: number; info: number };

/**
 * The activity monitor's Postgres rows: sources, anomalies and departments. A source's pulled
 * and logged events are IngestionSourceEventsRepository's; trace spend is read through TraceApi.
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
}
