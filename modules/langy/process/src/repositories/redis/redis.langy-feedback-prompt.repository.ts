import { z } from "zod";

import {
  type LangyFeedbackLastAsk,
  LangyFeedbackPromptRepository,
} from "../langy-feedback-prompt.repository.ts";

/** The Redis surface the cadence record needs. */
export type LangyFeedbackPromptRedis = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...expiry: ["EX", number]) => Promise<unknown>;
};

/** A month: long enough to span any quiet period, short enough not to pile up. */
const RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;

const lastAskSchema = z.object({
  atMs: z.number().refine(Number.isFinite),
  conversationId: z.string().catch(""),
});

const keyFor = (userId: string) => `langy:feedback:last-asked:${userId}`;

/** A stored record that is not JSON, or not a last ask, reads as none. */
function parseLastAsk(raw: string | null): LangyFeedbackLastAsk[] {
  if (!raw) return [];
  try {
    const parsed = lastAskSchema.safeParse(JSON.parse(raw));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

export class LangyFeedbackPromptRedisRepository extends LangyFeedbackPromptRepository {
  static create({
    redis,
  }: {
    redis: LangyFeedbackPromptRedis;
  }): LangyFeedbackPromptRedisRepository {
    return new LangyFeedbackPromptRedisRepository(redis);
  }

  private constructor(private readonly redis: LangyFeedbackPromptRedis) {
    super();
  }

  async findLastAsked(userId: string): Promise<LangyFeedbackLastAsk[]> {
    return parseLastAsk(await this.redis.get(keyFor(userId)));
  }

  async recordAsked({
    userId,
    lastAsk,
  }: {
    userId: string;
    lastAsk: LangyFeedbackLastAsk;
  }): Promise<void> {
    await this.redis.set(keyFor(userId), JSON.stringify(lastAsk), "EX", RECORD_TTL_SECONDS);
  }
}
