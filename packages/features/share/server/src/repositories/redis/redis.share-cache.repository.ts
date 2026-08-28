import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { ShareCacheRepository } from "../share-cache.repository";

const logger = createLogger("langwatch:share-cache");
const VIEW_KEY_PREFIX = "share_view:";
const PAYLOAD_KEY_PREFIX = "shared_trace:";
const VIEW_WINDOW_SECONDS = 30 * 60;
const PAYLOAD_TTL_SECONDS = 60;

export class RedisShareCacheRepository extends ShareCacheRepository {
  static create(options: { redis: IORedis | Cluster | null }): RedisShareCacheRepository {
    return new RedisShareCacheRepository(options.redis);
  }

  private constructor(private readonly redis: IORedis | Cluster | null) {
    super();
  }

  async isNewViewing({
    shareId,
    viewerKey,
  }: {
    shareId: string;
    viewerKey: string;
  }): Promise<boolean> {
    if (!this.redis) {
      return true;
    }

    try {
      const key = `${VIEW_KEY_PREFIX}${shareId}:${viewerKey}`;
      const result = await this.redis.set(key, "1", "EX", VIEW_WINDOW_SECONDS, "NX");

      return result === "OK";
    } catch (error) {
      logger.warn(
        { shareId, error },
        "share view dedupe unavailable; counting this open as a new viewing",
      );
      return true;
    }
  }

  async tryGetPayload(key: string): Promise<unknown | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const raw = await this.redis.get(`${PAYLOAD_KEY_PREFIX}${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      logger.warn({ error }, "shared trace cache read failed; assembling");
      return null;
    }
  }

  async setPayload(key: string, payload: unknown): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.set(
        `${PAYLOAD_KEY_PREFIX}${key}`,
        JSON.stringify(payload),
        "EX",
        PAYLOAD_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn({ error }, "shared trace cache write failed");
    }
  }
}
