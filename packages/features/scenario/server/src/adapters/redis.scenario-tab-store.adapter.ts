import { ScenarioTabStorePort } from "../ports/scenario-tab-store.port";

export interface ScenarioTabRedisMulti {
  zadd(key: string, score: number, member: string): ScenarioTabRedisMulti;
  expire(key: string, seconds: number): ScenarioTabRedisMulti;
  exec(): Promise<unknown>;
}

export interface ScenarioTabRedisConnection {
  multi(): ScenarioTabRedisMulti;
  zadd(
    key: string,
    exists: "XX",
    comparison: "LT",
    score: number,
    member: string,
  ): Promise<unknown>;
  zremrangebyscore(key: string, min: string, max: number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  set(key: string, value: string, expiry: "EX", seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export class RedisScenarioTabStoreAdapter extends ScenarioTabStorePort {
  static create(connection: ScenarioTabRedisConnection): RedisScenarioTabStoreAdapter {
    return new RedisScenarioTabStoreAdapter(connection);
  }

  private constructor(private readonly connection: ScenarioTabRedisConnection) {
    super();
  }

  async refresh(input: {
    key: string;
    member: string;
    score: number;
    ttlSeconds: number;
  }): Promise<void> {
    await this.connection
      .multi()
      .zadd(input.key, input.score, input.member)
      .expire(input.key, input.ttlSeconds)
      .exec();
  }

  async retire(input: { key: string; member: string; score: number }): Promise<void> {
    await this.connection.zadd(input.key, "XX", "LT", input.score, input.member);
  }

  async countAfter(input: { key: string; cutoff: number }): Promise<number> {
    await this.connection.zremrangebyscore(input.key, "-inf", input.cutoff);
    return this.connection.zcard(input.key);
  }

  async setPending(input: {
    key: string;
    url: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.connection.set(input.key, input.url, "EX", input.ttlSeconds);
  }

  async tryTakePending(key: string): Promise<string | null> {
    try {
      return await this.connection.getdel(key);
    } catch (error) {
      if (!isUnknownCommandError(error)) throw error;
    }

    const url = await this.connection.get(key);
    if (url) await this.connection.del(key);
    return url;
  }
}

function isUnknownCommandError(error: unknown): boolean {
  return error instanceof Error && /unknown command/i.test(error.message);
}
