/** Conversation-scoped Redis links used by Langy's navigate command. */
export interface LangyLinkRedis {
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number | boolean>;
}

export interface LangyResourceLinkStore {
  remember(input: {
    conversationId: string;
    links: Array<{ id: string; href: string }>;
  }): Promise<void>;
  resolve(input: { conversationId: string; id: string }): Promise<string | null>;
}

export class LangyResourceLinksStore implements LangyResourceLinkStore {
  private constructor(private readonly redis: LangyLinkRedis) {}

  static create(options: { redis: LangyLinkRedis }): LangyResourceLinksStore {
    return new LangyResourceLinksStore(options.redis);
  }

  async remember(input: {
    conversationId: string;
    links: Array<{ id: string; href: string }>;
  }): Promise<void> {
    if (input.links.length === 0) return;
    const key = `langy:navlink:${input.conversationId}`;
    for (const link of input.links) {
      await this.redis.hset(key, link.id, link.href);
    }
    await this.redis.expire(key, 24 * 60 * 60);
  }

  resolve(input: { conversationId: string; id: string }): Promise<string | null> {
    return this.redis.hget(`langy:navlink:${input.conversationId}`, input.id);
  }
}
