import type {
  LangyResourceLinkLookup,
  LangyResourceLinksRepository,
} from "../langy-live-turn.repository.ts";

/** Conversation-scoped Redis links used by Langy's navigate command. */
export interface LangyLinkRedis {
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number | boolean>;
}

export class LangyResourceLinksRedisRepository implements LangyResourceLinksRepository {
  private constructor(private readonly redis: LangyLinkRedis) {}

  static create(options: { redis: LangyLinkRedis }): LangyResourceLinksRedisRepository {
    return new LangyResourceLinksRedisRepository(options.redis);
  }

  async remember(input: {
    conversationId: string;
    links: { id: string; href: string }[];
  }): Promise<void> {
    if (input.links.length === 0) return;
    const key = `langy:navlink:${input.conversationId}`;
    for (const link of input.links) {
      await this.redis.hset(key, link.id, link.href);
    }
    await this.redis.expire(key, 24 * 60 * 60);
  }

  async resolve(input: { conversationId: string; id: string }): Promise<LangyResourceLinkLookup> {
    const href = await this.redis.hget(`langy:navlink:${input.conversationId}`, input.id);
    return href === null ? { kind: "miss" } : { kind: "hit", href };
  }
}
