import type { RedisConnection } from "@langwatch/redis-client";
import type { TakenPendingNavigate } from "@langwatch/scenario-contract";

import { type ScenarioTabStore } from "../../app/scenario.app.ts";

export class RedisScenarioTabStoreRepository implements ScenarioTabStore {
  static create(connection: RedisConnection): RedisScenarioTabStoreRepository {
    return new RedisScenarioTabStoreRepository(connection);
  }

  private constructor(private readonly connection: RedisConnection) {}

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

  async setPending(input: { key: string; url: string; ttlSeconds: number }): Promise<void> {
    await this.connection.set(input.key, input.url, "EX", input.ttlSeconds);
  }

  async takePending(key: string): Promise<TakenPendingNavigate> {
    try {
      return asTaken(await this.connection.getdel(key));
    } catch (error) {
      if (!isUnknownCommandError(error)) throw error;
    }

    const url = await this.connection.get(key);
    if (url) await this.connection.del(key);
    return asTaken(url);
  }
}

function asTaken(url: string | null): TakenPendingNavigate {
  return url ? { taken: true, url } : { taken: false };
}

function isUnknownCommandError(error: unknown): boolean {
  return error instanceof Error && /unknown command/i.test(error.message);
}
