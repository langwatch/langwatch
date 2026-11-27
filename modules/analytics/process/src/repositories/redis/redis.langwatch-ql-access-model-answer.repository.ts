import type { StoreClients } from "@langwatch/process-stores/members";

import {
  LWQL_ACCESS_MODEL_ANSWER_TTL_MS,
  type LangWatchQLAccessModelAnswer,
  LangWatchQLAccessModelAnswerRepository,
} from "../langwatch-ql-access-model-answer.repository.ts";

/** One key per LangWatchQL server, so a deployment's two targets never share an answer. */
function keyOf(origin: string): string {
  return `lwql:access-model-answer:${origin}`;
}

/** Only what the answer calls. */
export type LangWatchQLAccessModelAnswerRedis = Pick<StoreClients["redis"], "set" | "get">;

/** The fleet's last probe answer in the deployment's Redis, expiring by itself. */
export class RedisLangWatchQLAccessModelAnswerRepository extends LangWatchQLAccessModelAnswerRepository {
  private constructor(private readonly redis: LangWatchQLAccessModelAnswerRedis) {
    super();
  }

  static create({
    redis,
  }: {
    redis: LangWatchQLAccessModelAnswerRedis;
  }): RedisLangWatchQLAccessModelAnswerRepository {
    return new RedisLangWatchQLAccessModelAnswerRepository(redis);
  }

  async findAnswer({ origin }: { origin: string }): Promise<LangWatchQLAccessModelAnswer | null> {
    const held = await this.redis.get(keyOf(origin));
    return held === "provisioned" || held === "not_provisioned" ? held : null;
  }

  async recordAnswer({
    origin,
    answer,
  }: {
    origin: string;
    answer: LangWatchQLAccessModelAnswer;
  }): Promise<void> {
    await this.redis.set(keyOf(origin), answer, "PX", LWQL_ACCESS_MODEL_ANSWER_TTL_MS);
  }
}
