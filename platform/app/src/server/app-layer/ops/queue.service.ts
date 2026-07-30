import type {
  JobEntry,
  ParkedSummary,
  QueueRepository,
} from "./repositories/queue.repository";
import type { LaneInfo, LaneKindSummary } from "./types";

/**
 * The operator's read and recovery surface over the dispatch plane.
 *
 * A lane is the unit throughout: it is what the plane serialises on, so it is
 * what an operator inspects, unparks and drains.
 */
export class QueueService {
  constructor(readonly repo: QueueRepository) {}

  async getLaneKinds(): Promise<LaneKindSummary[]> {
    const laneKinds = await this.repo.discoverLaneKinds();
    const scanned = await this.repo.scanLaneKinds({ laneKinds, topN: 0 });
    return scanned.map(({ lanes: _lanes, ...summary }) => summary);
  }

  async getLanes(params: {
    laneKind: string;
    page: number;
    pageSize: number;
  }): Promise<{
    lanes: LaneInfo[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [kind] = await this.repo.scanLaneKinds({
      laneKinds: [params.laneKind],
    });
    if (!kind) {
      return {
        lanes: [],
        total: 0,
        page: params.page,
        pageSize: params.pageSize,
      };
    }

    // Lanes are loaded in full then sliced. The registry read is already capped,
    // so this is bounded by that cap rather than by the keyspace.
    const start = (params.page - 1) * params.pageSize;
    return {
      lanes: kind.lanes.slice(start, start + params.pageSize),
      total: kind.lanes.length,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async getLaneDetail(params: {
    laneKind: string;
    laneId: string;
  }): Promise<LaneInfo | null> {
    const [kind] = await this.repo.scanLaneKinds({
      laneKinds: [params.laneKind],
    });
    return kind?.lanes.find((lane) => lane.laneId === params.laneId) ?? null;
  }

  async getLaneJobs(params: {
    laneId: string;
    page: number;
    pageSize: number;
  }): Promise<{
    jobs: JobEntry[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.repo.getLaneJobs(params);
    return { ...result, page: params.page, pageSize: params.pageSize };
  }

  async getParkedSummary(): Promise<ParkedSummary> {
    const laneKinds = await this.repo.discoverLaneKinds();
    return this.repo.getParkedSummary({ laneKinds });
  }

  async unparkLane(params: {
    laneId: string;
  }): Promise<{ wasParked: boolean }> {
    return this.repo.unparkLane(params);
  }

  async unparkAll(params: {
    laneKind: string;
  }): Promise<{ unparkedCount: number }> {
    return this.repo.unparkAll(params);
  }

  async drainLane(params: {
    laneId: string;
  }): Promise<{ jobsRemoved: number }> {
    return this.repo.drainLane(params);
  }

  async drainTenant(params: {
    tenantId: string;
    laneIdContains?: string;
  }): Promise<{ lanesDrained: number; jobsDrained: number }> {
    return this.repo.drainTenant(params);
  }
}
