/**
 * The cancellation hint as a Redis key rather than a message: a message
 * reaches whoever is listening at the instant it is sent, and the next page
 * may be dispatched to a pod that was not. A key is a fact that page can read.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { createLogger } from "@langwatch/observability";

import type { InstantEvalCancellationRepository } from "../instant-eval-cancellation.repository.ts";

const logger = createLogger("langwatch:instant-evals:cancellation");

/**
 * How long the key outlives the request: an hour, which outlives the longest
 * run the caps allow. Expiring at all is what keeps a cancelled run's key
 * from outliving the run itself.
 */
const CANCEL_TTL_SECONDS = 60 * 60;

/** The two Redis calls this needs, and nothing more. */
export interface InstantEvalCancellationRedis {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  exists(key: string): Promise<number>;
}

/** Both directions fail soft; see the repository for why each answer is safe. */
export class RedisInstantEvalCancellationRepository implements InstantEvalCancellationRepository {
  #redis: InstantEvalCancellationRedis;

  private constructor(redis: InstantEvalCancellationRedis) {
    this.#redis = redis;
  }

  /** The key a run's hint is written under. */
  static keyOf(runId: string): string {
    return `instant_eval:cancel:${runId}`;
  }

  static create(redis: InstantEvalCancellationRedis): RedisInstantEvalCancellationRepository {
    return new RedisInstantEvalCancellationRepository(redis);
  }

  async request({ runId }: { runId: string }): Promise<void> {
    try {
      await this.#redis.set(
        RedisInstantEvalCancellationRepository.keyOf(runId),
        "1",
        "EX",
        CANCEL_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn(
        { runId, error },
        "Instant Eval cancellation hint could not be written; the run will stop on its recorded cancellation instead",
      );
    }
  }

  async isRequested({ runId }: { runId: string }): Promise<boolean> {
    try {
      return (await this.#redis.exists(RedisInstantEvalCancellationRepository.keyOf(runId))) > 0;
    } catch (error) {
      logger.warn(
        { runId, error },
        "Instant Eval cancellation hint could not be read; judging one more page",
      );

      return false;
    }
  }
}
