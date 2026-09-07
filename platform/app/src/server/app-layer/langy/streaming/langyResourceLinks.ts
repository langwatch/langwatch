/**
 * Langy resource-link store — the per-CONVERSATION memory of "which platform
 * address did a lookup surface for resource X", so a later `langwatch navigate
 * open <id>` can resolve where to send the browser.
 *
 * Why this exists as its own Redis-backed store (not an in-memory Map on the
 * relay): the relay is instantiated ONCE PER TURN (one worker→relay
 * connection), so an in-memory cache dies with the turn. But the natural user
 * flow is "look it up" in one turn and "open it" in the next — the navigate
 * lands in a fresh relay instance whose Map is empty, and the resolve silently
 * misses. Keying the cache by conversationId in Redis lets a link surfaced in
 * any turn resolve a navigate in any later turn of the same conversation.
 *
 * Only precise, provenance-trusted per-resource links are ever written here
 * (see `rememberResourceLink` in the relay); this store is a dumb key→href map.
 */

/** The minimal Redis surface this store needs (ioredis-compatible). Injected so
 * unit tests can drive an in-memory fake. */
export interface LangyLinkRedis {
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number | boolean>;
}

// Conversation-scoped, not turn-scoped. A day comfortably outlives any single
// chat while keeping leaked links bounded; every write refreshes the TTL so an
// active conversation's links never lapse mid-session.
const LINK_TTL_SECONDS = 24 * 60 * 60;

const keyFor = (conversationId: string): string =>
  `langy:navlink:${conversationId}`;

export interface LangyResourceLinkStore {
  /** Record one or more (id → href) links surfaced this turn, under the
   * conversation. Refreshes the conversation key's TTL. */
  remember(a: {
    conversationId: string;
    links: Array<{ id: string; href: string }>;
  }): Promise<void>;
  /** Resolve the href a navigate instruction should send the browser to, or
   * null when this conversation never surfaced the resource. */
  resolve(a: { conversationId: string; id: string }): Promise<string | null>;
}

export function createLangyResourceLinkStore(deps: {
  redis: LangyLinkRedis;
}): LangyResourceLinkStore {
  return {
    async remember({ conversationId, links }) {
      if (links.length === 0) return;
      const key = keyFor(conversationId);
      for (const { id, href } of links) {
        await deps.redis.hset(key, id, href);
      }
      await deps.redis.expire(key, LINK_TTL_SECONDS);
    },
    async resolve({ conversationId, id }) {
      return deps.redis.hget(keyFor(conversationId), id);
    },
  };
}
