// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ActivityEventDetailRow } from "@langwatch/enterprise-governance-contract";
import { toEpochMs } from "@langwatch/time";

import type {
  IngestionSourceEventsRepository,
  SourceEventWindows,
} from "../ingestion-source-events.repository.ts";

/** One organization's pulled and logged events, keyed by source id. */
export interface IngestionSourceEventsSnapshot {
  loggedAndPulledCountsBySource: Record<string, number>;
  pulledEventsBySource: Record<string, ActivityEventDetailRow[]>;
  loggedAndPulledWindowsBySource: Record<string, SourceEventWindows[]>;
}

/**
 * The ingestion-source-events twin: an organization with no events reads as empty; a test
 * seeds snapshots through `create`, keyed by organization id.
 */
export class MemoryIngestionSourceEventsRepository implements IngestionSourceEventsRepository {
  private readonly snapshots = new Map<string, Partial<IngestionSourceEventsSnapshot>>();

  static create({
    seed = {},
  }: {
    seed?: Readonly<Record<string, Partial<IngestionSourceEventsSnapshot>>>;
  } = {}): MemoryIngestionSourceEventsRepository {
    const repository = new MemoryIngestionSourceEventsRepository();
    for (const [organizationId, snapshot] of Object.entries(seed)) {
      repository.snapshots.set(organizationId, snapshot);
    }
    return repository;
  }

  private of(organizationId: string): IngestionSourceEventsSnapshot {
    return {
      loggedAndPulledCountsBySource: {},
      pulledEventsBySource: {},
      loggedAndPulledWindowsBySource: {},
      ...this.snapshots.get(organizationId),
    };
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
