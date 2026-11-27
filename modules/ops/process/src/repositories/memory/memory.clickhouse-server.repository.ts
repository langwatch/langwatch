import type { ClickHouseServerHealth } from "@langwatch/ops-contract";

import type {
  ClickHouseQueryErrorRow,
  ClickHouseServerRepository,
} from "../clickhouse.server.repository.ts";

const QUIET_SERVER: ClickHouseServerHealth = {
  nodes: 1,
  replicas: { tables: 0, readonly: 0, sessionExpired: 0, maxDelaySeconds: 0, maxQueueSize: 0 },
  merges: { running: 0, longestSeconds: 0, pendingMutations: 0 },
  disks: { count: 0, totalBytes: 0, freeBytes: 0, lowestFreeRatio: 1 },
  memory: { residentBytes: 0, totalBytes: 0 },
  tables: [],
};

/** A server holding whatever a test wrote: its failed statement groups and its health. */
export class MemoryClickHouseServerRepository implements ClickHouseServerRepository {
  errors: ClickHouseQueryErrorRow[] = [];
  health: ClickHouseServerHealth = QUIET_SERVER;

  private constructor() {}

  static create(): MemoryClickHouseServerRepository {
    return new MemoryClickHouseServerRepository();
  }

  async findQueryErrors({
    sinceMs,
    untilMs,
    code,
    source,
  }: {
    sinceMs: number;
    untilMs: number;
    code?: number | undefined;
    source?: string | undefined;
  }): Promise<ClickHouseQueryErrorRow[]> {
    return this.errors.filter(
      (row) =>
        row.lastAt >= sinceMs &&
        row.lastAt < untilMs &&
        (code === undefined || row.code === code) &&
        (source === undefined || row.source === source),
    );
  }

  async findHealth(_input: { cluster?: string | undefined }): Promise<ClickHouseServerHealth> {
    return this.health;
  }
}
