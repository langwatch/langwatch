/**
 * Handover shims. Three composition roots outside this module's claim still
 * name the pre-repository classes; each is one delegating subclass of the
 * repository that replaced it, and each goes as soon as the coordinator has
 * landed the replacement line named in the langy lane's report:
 * apps/api/src/app/api-production.composition.ts and
 * apps/worker/src/app/worker-langy-conversation.composition.ts.
 */
import {
  LangyAnalyticsEventClickHouseRepository,
  type LangyAnalyticsClickHouseClientResolver,
} from "../repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts";
import { LangyTokenBufferRedisRepository } from "../repositories/redis/redis.langy-token-buffer.repository.ts";
import {
  LangyTurnHandoffRedisRepository,
  type LangyHandoffRedis,
} from "../repositories/redis/redis.langy-turn-handoff.repository.ts";

/** Replaced by `setup.repositories.tokenBuffer`. */
export class LangyTokenBufferAdapter {
  static create(deps: { redis: unknown; blockingRedis?: unknown }): LangyTokenBufferRedisRepository {
    return LangyTokenBufferRedisRepository.create(deps);
  }
}

/** Replaced by `setup.repositories.turnHandoff`. */
export class LangyTurnHandoffAdapter {
  static create(options: { redis: LangyHandoffRedis }): LangyTurnHandoffRedisRepository {
    return LangyTurnHandoffRedisRepository.create(options);
  }
}

/** Replaced by the ClickHouse tier of `langyRepositories`. */
export class ClickHouseLangyAnalyticsEventAdapter {
  static create(
    resolveClient: LangyAnalyticsClickHouseClientResolver,
  ): LangyAnalyticsEventClickHouseRepository {
    return LangyAnalyticsEventClickHouseRepository.create(resolveClient);
  }
}
