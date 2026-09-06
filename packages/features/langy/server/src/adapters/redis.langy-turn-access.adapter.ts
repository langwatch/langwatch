import {
  LANGY_TURN_ACCESS_TTL_SECONDS,
  type LangyTurnAccess,
  LangyTurnAccessPort,
  langyTurnAccessSchema,
} from "../ports/langy-turn-access.port.ts";

interface LangyAccessRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
}

/** Redis-backed turn access, keyed by conversation so a turn's slot hashes together. */
export class LangyTurnAccessAdapter extends LangyTurnAccessPort {
  static create(options: { redis: LangyAccessRedis }): LangyTurnAccessAdapter {
    return new LangyTurnAccessAdapter(options.redis);
  }

  private constructor(private readonly redis: LangyAccessRedis) {
    super();
  }

  async grant(access: LangyTurnAccess): Promise<void> {
    const parsed = langyTurnAccessSchema.parse(access);
    await this.redis.set(
      `langy:turn-access:{${parsed.conversationId}}:${parsed.turnId}`,
      JSON.stringify(parsed),
      "EX",
      LANGY_TURN_ACCESS_TTL_SECONDS,
    );
  }

  async isTurnActor(access: LangyTurnAccess): Promise<boolean> {
    const raw = await this.redis.get(
      `langy:turn-access:{${access.conversationId}}:${access.turnId}`,
    );
    if (raw == null) return false;
    try {
      const stored = langyTurnAccessSchema.parse(JSON.parse(raw));
      return stored.projectId === access.projectId && stored.userId === access.userId;
    } catch {
      return false;
    }
  }
}
