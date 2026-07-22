import { createLogger } from "@langwatch/observability";
import type { Cluster } from "ioredis";
import type IORedis from "ioredis";

const logger = createLogger("langwatch:share-view-dedupe");

const SHARE_VIEW_KEY_PREFIX = "share_view:";

/**
 * How long one viewer's opening of a link keeps counting as the same viewing.
 *
 * Deliberately a fixed window from the first open, not a sliding one: the key
 * is set once and left to expire, so "one view" means one viewing session of
 * up to this long rather than an indefinitely renewable pass.
 */
export const SHARE_VIEW_WINDOW_SECONDS = 30 * 60;

export interface ShareViewDedupeService {
  /**
   * Whether this open should consume a view. True for a viewer opening the
   * link for the first time in the window; false when the same viewer is
   * re-reading (a refresh, a restored tab, a second render).
   */
  isNewViewing(params: {
    shareId: string;
    viewerKey: string;
  }): Promise<boolean>;
}

/** No Redis (tests, SKIP_REDIS, dev without Redis): every open is a new viewing. */
class NullShareViewDedupeService implements ShareViewDedupeService {
  async isNewViewing(): Promise<boolean> {
    return true;
  }
}

/**
 * Redis `SET NX` with a TTL, mirroring the span-dedupe service.
 *
 * This makes `maxViews` mean *distinct viewings* rather than HTTP requests.
 * Without it a single-view link dies on the recipient's first refresh, which
 * is not what an operator means by "one view".
 *
 * It changes only the accounting. Authorization is re-evaluated in full on
 * every request — a revoked link stops resolving immediately, and expiry, the
 * kill switch and the audience check all still run — so this is not a session
 * or a grant, and it does not reintroduce the cookie layer ADR-057 deleted.
 */
export class RedisShareViewDedupeService implements ShareViewDedupeService {
  constructor(private readonly redis: IORedis | Cluster) {}

  async isNewViewing({
    shareId,
    viewerKey,
  }: {
    shareId: string;
    viewerKey: string;
  }): Promise<boolean> {
    const key = `${SHARE_VIEW_KEY_PREFIX}${shareId}:${viewerKey}`;
    try {
      const result = await this.redis.set(
        key,
        "1",
        "EX",
        SHARE_VIEW_WINDOW_SECONDS,
        "NX",
      );
      return result === "OK";
    } catch (error) {
      // Fail toward consuming. Under-counting would let a view cap be
      // exceeded; over-counting only costs the viewer a refresh, so a Redis
      // outage must not be a way to read a single-view link repeatedly.
      logger.warn(
        { shareId, error },
        "share view dedupe unavailable; counting this open as a new viewing",
      );
      return true;
    }
  }
}

export function createShareViewDedupeService(
  redis: IORedis | Cluster | null,
): ShareViewDedupeService {
  if (!redis) return new NullShareViewDedupeService();
  return new RedisShareViewDedupeService(redis);
}
