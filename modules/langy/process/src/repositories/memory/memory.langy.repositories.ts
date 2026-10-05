import { memorySessionState } from "@langwatch/process-stores";

import type { LangyRepositories } from "../langy-repositories.registry.ts";
import { LangyMemoryStore } from "./langy-memory.store.ts";
import { LangyAnalyticsEventMemoryRepository } from "./memory.langy-analytics-event.repository.ts";
import { MemoryLangyConversationProjectionRepository } from "./memory.langy-conversation-projection.repository.ts";
import { MemoryLangyConversationTurnProjectionRepository } from "./memory.langy-conversation-turn-projection.repository.ts";
import { MemoryLangyConversationRepository } from "./memory.langy-conversation.repository.ts";
import { MemoryLangyCredentialRepository } from "./memory.langy-credential.repository.ts";
import { LangyFeedbackPromptMemoryRepository } from "./memory.langy-feedback-prompt.repository.ts";
import { LangyGithubPrCountMemoryRepository } from "./memory.langy-github-pr-count.repository.ts";
import {
  LangyFrameDedupMemoryRepository,
  LangyResourceLinksMemoryRepository,
  LangyTurnAccessMemoryRepository,
  LangyTurnHandoffMemoryRepository,
} from "./memory.langy-live-turn.repository.ts";
import { LangyLocalPresenceMemoryRepository } from "./memory.langy-local-presence.repository.ts";
import { MemoryLangyMessageProjectionRepository } from "./memory.langy-message-projection.repository.ts";
import { MemoryLangyMessageRepository } from "./memory.langy-message.repository.ts";
import { MemoryLangyRateLimitRepository } from "./memory.langy-rate-limit.repository.ts";
import { MemoryLangySessionKeyReapRepository } from "./memory.langy-session-key-reap.repository.ts";
import { MemoryLangySessionKeyRepository } from "./memory.langy-session-key.repository.ts";
import { LangyTokenBufferMemoryRepository } from "./memory.langy-token-buffer.repository.ts";
import { MemoryLangyTurnAdmissionRepository } from "./memory.langy-turn-admission.repository.ts";
import { MemoryLangyUiActionRepository } from "./memory.langy-ui-action.repository.ts";

/** The "memory" tier: every langy row the app is tested without a datastore. */
export class MemoryLangyRepositories {
  static readonly requires = [] as const;

  static create(): LangyRepositories {
    // One store behind every row, the way one Redis connection serves them: a
    // grant written through `turnAccess` is what `turnAccess` answers with,
    // and a token appended to the buffer is what a follow reads back.
    const store = LangyMemoryStore.create();

    return {
      conversations: MemoryLangyConversationRepository.create(store),
      messages: MemoryLangyMessageRepository.create(store),
      credentials: MemoryLangyCredentialRepository.create(store),
      admission: MemoryLangyTurnAdmissionRepository.create(store),
      conversationState: MemoryLangyConversationProjectionRepository.create(store),
      conversationTurnState: MemoryLangyConversationTurnProjectionRepository.create(store),
      messageStorage: MemoryLangyMessageProjectionRepository.create(store),
      sessionKeys: MemoryLangySessionKeyRepository.create(store),
      sessionKeyReap: MemoryLangySessionKeyReapRepository.create(store),
      turnAccess: LangyTurnAccessMemoryRepository.create(store),
      turnHandoff: LangyTurnHandoffMemoryRepository.create(store),
      frameDedup: LangyFrameDedupMemoryRepository.create(store),
      resourceLinks: LangyResourceLinksMemoryRepository.create(store),
      localPresence: LangyLocalPresenceMemoryRepository.create(store),
      sessionState: memorySessionState(),
      githubPrCounts: LangyGithubPrCountMemoryRepository.create(),
      feedbackPrompts: LangyFeedbackPromptMemoryRepository.create(),
      // Every call returns the twin over the SAME shared store, the way one
      // Redis serves every open() on the live tier; there is no connection to give back.
      tokenBuffer: {
        open: () => LangyTokenBufferMemoryRepository.create(store),
        openBlocking: () => ({
          buffer: LangyTokenBufferMemoryRepository.create(store),
          release: () => undefined,
        }),
      },
      uiActions: MemoryLangyUiActionRepository.create(store),
      analyticsEvents: LangyAnalyticsEventMemoryRepository.create(store),
      rateLimits: MemoryLangyRateLimitRepository.create(),
    };
  }
}
