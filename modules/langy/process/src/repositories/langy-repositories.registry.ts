import type { AppendStore, StateProjectionStore } from "@langwatch/eventing";
import { defineRepositories } from "@langwatch/kernel";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import type { LangyAnalyticsEventRepository } from "./langy-analytics-event.repository.ts";
import type { LangyConversationRepository } from "./langy-conversation-projection.repository.ts";
import type { LangyCredentialRepository } from "./langy-credential.repository.ts";
import type { LangyFeedbackPromptRepository } from "./langy-feedback-prompt.repository.ts";
import type { LangyGithubPrCountRepository } from "./langy-github-pr-count.repository.ts";
import type {
  LangyFrameDedupRepository,
  LangyResourceLinksRepository,
  LangyTurnAccessRepository,
  LangyTurnHandoffRepository,
} from "./langy-live-turn.repository.ts";
import type { LangyLocalPresenceRepository } from "./langy-local-presence.repository.ts";
import type { LangyMessageRepository } from "./langy-message.repository.ts";
import type { LangySessionKeyRepository } from "./langy-session-key.repository.ts";
import type {
  LangyTokenBufferConnection,
  LangyTokenBufferRepository,
} from "./langy-token-buffer.repository.ts";
import type { LangyTurnAdmissionRepository } from "./langy-turn-admission.repository.ts";
import { MemoryLangyRepositories } from "./memory/memory.langy.repositories.ts";
import type { LangyDatabase } from "./prisma/langy-database.mapper.ts";
import { PrismaLangyRepositories } from "./prisma/prisma.langy.repositories.ts";
import { PostgresLangyRepositories } from "./redis/redis.langy.repositories.ts";

/**
 * The rows the langy module keeps outside its event log, chosen once at
 * boot: watch access, worker pickup, seen frames, navigate links, shared
 * folder, live token edge. Redis holds them where a deployment has one.
 */
export interface LangyRepositories {
  readonly turnAccess: LangyTurnAccessRepository;
  readonly turnHandoff: LangyTurnHandoffRepository;
  readonly frameDedup: LangyFrameDedupRepository;
  readonly resourceLinks: LangyResourceLinksRepository;
  readonly localPresence: LangyLocalPresenceRepository;
  readonly sessionState: SessionStateStore;
  /** The per-user daily count of pull requests Langy opened. */
  readonly githubPrCounts: LangyGithubPrCountRepository;
  /** When each person was last asked for feedback. */
  readonly feedbackPrompts: LangyFeedbackPromptRepository;
  /**
   * Opens the live edge over one turn's own borrowed connection (ADR-044 part
   * 3): a blocking tail duplicates a connection per stream, so this row is a
   * factory rather than one instance chosen at boot.
   */
  readonly tokenBuffer: {
    open(connection: LangyTokenBufferConnection): LangyTokenBufferRepository;
  };
  /** Where the content-free analytics grain the worker folds lands. */
  readonly analyticsEvents: LangyAnalyticsEventRepository;
}

export const langyRepositories = defineRepositories({
  live: PostgresLangyRepositories,
  memory: MemoryLangyRepositories,
});

/** The rows langy keeps in its own Postgres tables: conversations, messages, keys, projections. */
export interface LangyDatabaseRepositories {
  readonly conversations: LangyConversationRepository;
  readonly messages: LangyMessageRepository;
  readonly credentials: LangyCredentialRepository;
  readonly admission: LangyTurnAdmissionRepository;
  readonly conversationState: StateProjectionStore<LangyConversationStateData>;
  readonly conversationTurnState: StateProjectionStore<LangyConversationTurnData>;
  readonly messageStorage: AppendStore<LangyMessageProjectionRecord>;
  readonly sessionKeys: LangySessionKeyRepository;
}

/** Langy's Postgres rows over the process's database — the one place their backend is named. */
export function createLangyDatabaseRepositories(
  database: LangyDatabase,
): LangyDatabaseRepositories {
  return PrismaLangyRepositories.create(database);
}
