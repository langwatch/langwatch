import type { Redis } from "ioredis";

import {
  LANGY_HANDOFF_TTL_SECONDS,
  type LangyTurnHandoff,
  type LangyTurnHandoffLookup,
  LangyTurnHandoffRepository,
  langyTurnHandoffSchema,
} from "../langy-live-turn.repository.ts";

export type LangyHandoffRedis = Pick<Redis, "set" | "get" | "expire">;

/** Redis-backed turn handoff, parked for `LANGY_HANDOFF_TTL_SECONDS`. */
export class LangyTurnHandoffRedisRepository extends LangyTurnHandoffRepository {
  static create(options: { redis: LangyHandoffRedis }): LangyTurnHandoffRedisRepository {
    return new LangyTurnHandoffRedisRepository(options.redis);
  }

  private constructor(private readonly redis: LangyHandoffRedis) {
    super();
  }

  async stash(handoff: LangyTurnHandoff): Promise<void> {
    const parsed = langyTurnHandoffSchema.parse(handoff);
    await this.redis.set(
      `langy:handoff:{${parsed.conversationId}}:${parsed.turnId}`,
      JSON.stringify(parsed),
      "EX",
      LANGY_HANDOFF_TTL_SECONDS,
    );
  }

  async read(input: { conversationId: string; turnId: string }): Promise<LangyTurnHandoffLookup> {
    const raw = await this.redis.get(`langy:handoff:{${input.conversationId}}:${input.turnId}`);
    if (raw == null) return { kind: "miss" };
    try {
      return { kind: "hit", handoff: langyTurnHandoffSchema.parse(JSON.parse(raw)) };
    } catch {
      return { kind: "miss" };
    }
  }

  async markStopped(input: { conversationId: string; turnId: string }): Promise<void> {
    await this.redis.set(
      `langy:stopped:{${input.conversationId}}:${input.turnId}`,
      "1",
      "EX",
      LANGY_HANDOFF_TTL_SECONDS,
    );
  }

  async isStopped(input: { conversationId: string; turnId: string }): Promise<boolean> {
    return (
      (await this.redis.get(`langy:stopped:{${input.conversationId}}:${input.turnId}`)) !== null
    );
  }

  async refresh(input: { conversationId: string; turnId: string }): Promise<boolean> {
    const refreshed = await this.redis.expire(
      `langy:handoff:{${input.conversationId}}:${input.turnId}`,
      LANGY_HANDOFF_TTL_SECONDS,
    );
    return refreshed === 1;
  }
}
