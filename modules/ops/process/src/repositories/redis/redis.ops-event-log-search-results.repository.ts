import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS,
  type OpsEventLogSearchRecord,
  OpsEventLogSearchResultsRepository,
  opsEventLogSearchRecordSchema,
} from "../ops-event-log-search-results.repository.ts";

/** One key per search, set with its time to live, so Redis expires it. */
export class RedisOpsEventLogSearchResultsRepository extends OpsEventLogSearchResultsRepository {
  static create({ redis }: { redis: IORedis | Cluster }): RedisOpsEventLogSearchResultsRepository {
    return new RedisOpsEventLogSearchResultsRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save({
    requestId,
    record,
  }: {
    requestId: string;
    record: OpsEventLogSearchRecord;
  }): Promise<void> {
    await this.redis.set(
      keyOf(requestId),
      JSON.stringify(record),
      "EX",
      OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS,
    );
  }

  async findByRequestId({ requestId }: { requestId: string }): Promise<OpsEventLogSearchRecord[]> {
    const raw = await this.redis.get(keyOf(requestId));
    if (raw === null) return [];
    const parsed = opsEventLogSearchRecordSchema.safeParse(readJson(raw));
    return parsed.success ? [parsed.data] : [];
  }
}

function keyOf(requestId: string): string {
  return `ops:event_log_search:${requestId}`;
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
