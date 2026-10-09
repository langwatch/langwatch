import {
  reapStrandedGroups,
  type ReapStrandedGroupsReport,
} from "@langwatch/group-queue/operational";
import type { RedisConnection } from "@langwatch/redis-client";

import { GroupQueueReaperRepository } from "../group-queue-reaper.repository.ts";

/** Main's `reap-stranded-group-keys.sh`, always applied, over the event-sourcing queue's Redis. */
export class RedisGroupQueueReaperRepository extends GroupQueueReaperRepository {
  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  static create({ redis }: { redis: RedisConnection }): RedisGroupQueueReaperRepository {
    return new RedisGroupQueueReaperRepository(redis);
  }

  reapStrandedGroups({
    minAgeHours,
    signal,
  }: {
    minAgeHours: number;
    signal?: AbortSignal;
  }): Promise<ReapStrandedGroupsReport> {
    return reapStrandedGroups({ redis: this.redis, apply: true, minAgeHours, signal });
  }
}
