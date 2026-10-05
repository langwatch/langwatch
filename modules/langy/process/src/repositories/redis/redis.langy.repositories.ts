import type { RedisConnection } from "@langwatch/redis-client";
import { SessionStateStoreFactory } from "@langwatch/redis-client";

import type { LangyRepositories } from "../langy-repositories.registry.ts";
import { LangyFeedbackPromptRedisRepository } from "./redis.langy-feedback-prompt.repository.ts";
import { LangyFrameDedupRedisRepository } from "./redis.langy-frame-dedup.repository.ts";
import { LangyGithubPrCountRedisRepository } from "./redis.langy-github-pr-count.repository.ts";
import { LangyLocalPresenceRedisRepository } from "./redis.langy-local-presence.repository.ts";
import { LangyResourceLinksRedisRepository } from "./redis.langy-resource-links.repository.ts";
import { LangyTokenBufferRedisRepository } from "./redis.langy-token-buffer.repository.ts";
import { LangyTurnAccessRedisRepository } from "./redis.langy-turn-access.repository.ts";
import { LangyTurnHandoffRedisRepository } from "./redis.langy-turn-handoff.repository.ts";
import { RedisLangyUiActionRepository } from "./redis.langy-ui-action.repository.ts";

/** The live edge's rows, every one in the process's Redis. */
export type LangyRedisRows = Pick<
  LangyRepositories,
  | "turnAccess"
  | "turnHandoff"
  | "frameDedup"
  | "resourceLinks"
  | "localPresence"
  | "sessionState"
  | "githubPrCounts"
  | "feedbackPrompts"
  | "tokenBuffer"
  | "uiActions"
>;

/** Builds the live edge's rows over one Redis connection. */
export class RedisLangyRepositories {
  static create(redis: RedisConnection): LangyRedisRows {
    const sessionState = SessionStateStoreFactory.redis(redis);

    return {
      turnAccess: LangyTurnAccessRedisRepository.create({ redis }),
      turnHandoff: LangyTurnHandoffRedisRepository.create({ redis }),
      frameDedup: LangyFrameDedupRedisRepository.create({ redis }),
      resourceLinks: LangyResourceLinksRedisRepository.create({ redis }),
      localPresence: LangyLocalPresenceRedisRepository.create({ store: sessionState }),
      sessionState,
      githubPrCounts: LangyGithubPrCountRedisRepository.create({ redis }),
      feedbackPrompts: LangyFeedbackPromptRedisRepository.create({ redis }),
      // Every open builds a fresh buffer; a blocking tail duplicates a
      // connection of its own and gives it back on release.
      tokenBuffer: {
        open: () => LangyTokenBufferRedisRepository.create({ redis }),
        openBlocking: () => {
          const blockingRedis = redis.duplicate();
          return {
            buffer: LangyTokenBufferRedisRepository.create({ redis, blockingRedis }),
            release: () => blockingRedis.disconnect(),
          };
        },
      },
      uiActions: RedisLangyUiActionRepository.create({ redis }),
    };
  }
}
