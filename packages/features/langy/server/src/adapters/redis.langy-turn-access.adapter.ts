import { z } from "zod";

/** Synchronous actor authorization record for Langy's live turn stream. */
export const LANGY_TURN_ACCESS_TTL_SECONDS = 300;

const langyTurnAccessSchema = z
  .object({
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();
export type LangyTurnAccess = z.infer<typeof langyTurnAccessSchema>;

interface LangyAccessRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
}

export class LangyTurnAccessStore {
  private constructor(private readonly redis: LangyAccessRedis) {}

  static create(options: { redis: LangyAccessRedis }): LangyTurnAccessStore {
    return new LangyTurnAccessStore(options.redis);
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
