import type { AppendStore, StateProjectionStore } from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";
import { defineRepositories } from "@langwatch/process";
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
import type { LangyRateLimitRepository } from "./langy-rate-limit.repository.ts";
import type { LangySessionKeyReapRepository } from "./langy-session-key-reap.repository.ts";
import type { LangySessionKeyRepository } from "./langy-session-key.repository.ts";
import type { LangyTokenBufferRepository } from "./langy-token-buffer.repository.ts";
import type { LangyTurnAdmissionRepository } from "./langy-turn-admission.repository.ts";
import type { LangyUiActionRepository } from "./langy-ui-action.repository.ts";
import { LiveLangyRepositories } from "./live/live.langy.repositories.ts";
import { MemoryLangyRepositories } from "./memory/memory.langy.repositories.ts";

/**
 * Every row the langy module keeps, chosen once at boot: its own tables, and
 * the live edge (watch access, worker pickup, seen frames, navigate links,
 * shared folder, token stream) Redis holds in a deployment.
 */
export interface LangyRepositories extends LangyDatabaseRepositories {
  /** The fleet-wide sweep's one write over elapsed session keys. */
  readonly sessionKeyReap: LangySessionKeyReapRepository;
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
   * Opens the live edge (ADR-044 part 3). Every call builds a fresh buffer; a
   * blocking tail holds a connection of its own until it is released.
   */
  readonly tokenBuffer: {
    open(): LangyTokenBufferRepository;
    openBlocking(): { buffer: LangyTokenBufferRepository; release(): void };
  };
  /** The agent-to-page action channel: pending record, claim, result list. */
  readonly uiActions: LangyUiActionRepository;
  /** Where the content-free analytics grain the worker folds lands. */
  readonly analyticsEvents: LangyAnalyticsEventRepository;
  /** The turn window's, the panel sends' and the worker warms' fixed windows. */
  readonly rateLimits: LangyRateLimitRepository;
}

export const langyRepositories = defineRepositories({
  live: LiveLangyRepositories,
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
