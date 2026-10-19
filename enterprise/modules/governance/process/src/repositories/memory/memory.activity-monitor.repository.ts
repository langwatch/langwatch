// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  ActivityEventDetailRow,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
} from "@langwatch/enterprise-governance-contract";
import { toEpochMs } from "@langwatch/time";

import type {
  DepartmentDirectory,
  SourceTeam,
} from "../../features/cost/rules/activity-monitor-spend.rules.ts";
import type {
  ActivityMonitorRepository,
  AnomalyBreakdown,
  SourceEventWindows,
} from "../activity-monitor.repository.ts";

type SourceDataCoverage = Awaited<ReturnType<ActivityMonitorRepository["sourceDataCoverage"]>>;

/** One organization's own activity-monitor state; trace spend is TraceApi's, not seeded here. */
export interface ActivityMonitorSnapshot {
  anomalyBreakdown: AnomalyBreakdown;
  recentAnomalies: RecentAnomalyRow[];
  departmentDirectory: DepartmentDirectory;
  teamBySource: Record<string, SourceTeam>;
  activeSources: Omit<IngestionSourceHealthRow, "eventsLast24h">[];
  loggedAndPulledCountsBySource: Record<string, number>;
  pulledEventsBySource: Record<string, ActivityEventDetailRow[]>;
  loggedAndPulledWindowsBySource: Record<string, SourceEventWindows[]>;
  coverageBySource: Record<string, SourceDataCoverage>;
}

function emptySnapshot(): ActivityMonitorSnapshot {
  return {
    anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
    recentAnomalies: [],
    departmentDirectory: {
      projectDepartmentById: new Map(),
      userDepartmentByEmail: new Map(),
      userTeamDepartmentByEmail: new Map(),
      activeDepartmentNames: new Map(),
    },
    teamBySource: {},
    activeSources: [],
    loggedAndPulledCountsBySource: {},
    pulledEventsBySource: {},
    loggedAndPulledWindowsBySource: {},
    coverageBySource: {},
  };
}

/**
 * The activity-monitor twin: an organization with no state reads as empty; a test seeds
 * snapshots through `create`, keyed by organization id.
 */
export class MemoryActivityMonitorRepository implements ActivityMonitorRepository {
  private readonly snapshots = new Map<string, Partial<ActivityMonitorSnapshot>>();

  static create({
    seed = {},
  }: {
    seed?: Readonly<Record<string, Partial<ActivityMonitorSnapshot>>>;
  } = {}): MemoryActivityMonitorRepository {
    const repository = new MemoryActivityMonitorRepository();
    for (const [organizationId, snapshot] of Object.entries(seed)) {
      repository.snapshots.set(organizationId, snapshot);
    }
    return repository;
  }

  private of(organizationId: string): ActivityMonitorSnapshot {
    return { ...emptySnapshot(), ...this.snapshots.get(organizationId) };
  }

  async sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceDataCoverage> {
    return (
      this.of(input.organizationId).coverageBySource[input.sourceId] ?? {
        health: "healthy",
        consecutiveFailures: 0,
        lastSuccessfulPullIso: null,
        days: [],
      }
    );
  }

  async recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]> {
    return this.of(input.organizationId).recentAnomalies.slice(0, input.limit ?? 50);
  }

  async getOpenAnomalyBreakdown(input: { organizationId: string }): Promise<AnomalyBreakdown> {
    return this.of(input.organizationId).anomalyBreakdown;
  }

  async getDepartmentDirectory(input: { organizationId: string }): Promise<DepartmentDirectory> {
    return this.of(input.organizationId).departmentDirectory;
  }

  async findSourceTeams(input: {
    organizationId: string;
    sourceIds: readonly string[];
  }): Promise<{ sourceId: string; team: SourceTeam }[]> {
    const teams = this.of(input.organizationId).teamBySource;
    return input.sourceIds
      .filter((sourceId) => sourceId in teams)
      .map((sourceId) => ({ sourceId, team: teams[sourceId] ?? null }));
  }

  async findActiveSources(input: {
    organizationId: string;
  }): Promise<Omit<IngestionSourceHealthRow, "eventsLast24h">[]> {
    return this.of(input.organizationId).activeSources;
  }

  async countLoggedAndPulledEventsBySource(input: {
    organizationId: string;
    sourceIds: readonly string[];
  }): Promise<{ sourceId: string; count: number }[]> {
    const counts = this.of(input.organizationId).loggedAndPulledCountsBySource;
    return input.sourceIds
      .filter((sourceId) => counts[sourceId] !== undefined)
      .map((sourceId) => ({ sourceId, count: counts[sourceId]! }));
  }

  async findPulledEventsForSource(input: {
    organizationId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<ActivityEventDetailRow[]> {
    const events = this.of(input.organizationId).pulledEventsBySource[input.sourceId] ?? [];
    return events
      .filter((e) => toEpochMs(e.eventTimestampIso) < input.beforeMs)
      .slice(0, input.limit);
  }

  async findLoggedAndPulledEventWindows(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceEventWindows[]> {
    return this.of(input.organizationId).loggedAndPulledWindowsBySource[input.sourceId] ?? [];
  }
}
