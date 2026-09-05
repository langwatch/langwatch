import { langyWorkerCredentialsSchema } from "@langwatch/langy-contract";
import { z } from "zod";

const langyTurnHandoffSchema = z
  .object({
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    actorUserId: z.string().min(1),
    prompt: z.string(),
    system: z.string(),
    historySeed: z.string().optional(),
    modelOverride: z.string().optional(),
    credentials: langyWorkerCredentialsSchema,
    runToken: z.string().min(1),
    permitReserved: z.boolean(),
    resumeToken: z.string().optional(),
  })
  .strict();
export type LangyTurnHandoff = z.infer<typeof langyTurnHandoffSchema>;

export interface LangyHandoffRedis {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  expire(key: string, ttl: number): Promise<number>;
}

export const LANGY_HANDOFF_TTL_SECONDS = 300;

export class LangyTurnHandoffStore {
  private constructor(private readonly redis: LangyHandoffRedis) {}

  static create(options: { redis: LangyHandoffRedis }): LangyTurnHandoffStore {
    return new LangyTurnHandoffStore(options.redis);
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

  async read(input: { conversationId: string; turnId: string }): Promise<LangyTurnHandoff | null> {
    const raw = await this.redis.get(`langy:handoff:{${input.conversationId}}:${input.turnId}`);
    if (raw == null) return null;
    try {
      return langyTurnHandoffSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async refresh(input: { conversationId: string; turnId: string }): Promise<boolean> {
    const refreshed = await this.redis.expire(
      `langy:handoff:{${input.conversationId}}:${input.turnId}`,
      LANGY_HANDOFF_TTL_SECONDS,
    );
    return refreshed === 1;
  }
}
