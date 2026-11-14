import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  OPS_EXPLAIN_RESULT_TTL_SECONDS,
  type OpsExplainRecord,
  OpsExplainResultsRepository,
  opsExplainRecordSchema,
} from "../ops-explain-results.repository.ts";

/** One key per request, set with its time to live, so Redis expires it. */
export class RedisOpsExplainResultsRepository extends OpsExplainResultsRepository {
  static create({ redis }: { redis: IORedis | Cluster }): RedisOpsExplainResultsRepository {
    return new RedisOpsExplainResultsRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save({
    requestId,
    record,
  }: {
    requestId: string;
    record: OpsExplainRecord;
  }): Promise<void> {
    await this.redis.set(
      keyOf(requestId),
      JSON.stringify(record),
      "EX",
      OPS_EXPLAIN_RESULT_TTL_SECONDS,
    );
  }

  async findByRequestId({ requestId }: { requestId: string }): Promise<OpsExplainRecord[]> {
    const raw = await this.redis.get(keyOf(requestId));
    if (raw === null) return [];
    const parsed = opsExplainRecordSchema.safeParse(readJson(raw));
    return parsed.success ? [parsed.data] : [];
  }
}

function keyOf(requestId: string): string {
  return `ops:clickhouse_explain:${requestId}`;
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
