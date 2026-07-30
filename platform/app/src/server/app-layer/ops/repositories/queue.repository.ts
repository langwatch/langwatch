// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { ErrorCluster, LaneKindInfo } from "../types";

export interface ParkedSummary {
  totalParked: number;
  clusters: ErrorCluster[];
}

/** One staged job, read from the lane's header hash — never its body. */
export interface JobEntry {
  /** The lane-local sequence the stage script assigned. */
  sequence: number;
  orderingKey: number;
  eventType: string;
  eventId: string;
  aggregateId: string;
  attempt: number;
  costBytes: number;
  /** Set when the body was offloaded to the blob spool. */
  blobRef: string | null;
}

export interface QueueRepository {
  /** The lane kinds currently present in the registry. */
  discoverLaneKinds(): Promise<string[]>;

  scanLaneKinds(params: {
    laneKinds: string[];
    topN?: number;
  }): Promise<LaneKindInfo[]>;

  getLaneJobs(params: {
    laneId: string;
    page: number;
    pageSize: number;
  }): Promise<{ jobs: JobEntry[]; total: number }>;

  getParkedSummary(params: { laneKinds: string[] }): Promise<ParkedSummary>;

  unparkLane(params: { laneId: string }): Promise<{ wasParked: boolean }>;

  unparkAll(params: { laneKind: string }): Promise<{ unparkedCount: number }>;

  /** Removes every staged job and every key belonging to the lane. Unrecoverable. */
  drainLane(params: { laneId: string }): Promise<{ jobsRemoved: number }>;

  drainTenant(params: {
    tenantId: string;
    laneIdContains?: string;
  }): Promise<{ lanesDrained: number; jobsDrained: number }>;
}

export class NullQueueRepository implements QueueRepository {
  async discoverLaneKinds(): Promise<string[]> {
    return [];
  }

  async scanLaneKinds(): Promise<LaneKindInfo[]> {
    return [];
  }

  async getLaneJobs(): Promise<{ jobs: JobEntry[]; total: number }> {
    return { jobs: [], total: 0 };
  }

  async getParkedSummary(): Promise<ParkedSummary> {
    return { totalParked: 0, clusters: [] };
  }

  async unparkLane(): Promise<{ wasParked: boolean }> {
    return { wasParked: false };
  }

  async unparkAll(): Promise<{ unparkedCount: number }> {
    return { unparkedCount: 0 };
  }

  async drainLane(): Promise<{ jobsRemoved: number }> {
    return { jobsRemoved: 0 };
  }

  async drainTenant(): Promise<{ lanesDrained: number; jobsDrained: number }> {
    return { lanesDrained: 0, jobsDrained: 0 };
  }
}
