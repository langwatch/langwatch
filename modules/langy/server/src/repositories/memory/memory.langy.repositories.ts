import type { LangyRepositories } from "../langy-repositories.registry.ts";
import { LangyMemoryStore } from "./langy-memory.store.ts";
import {
  LangyFrameDedupMemoryRepository,
  LangyResourceLinksMemoryRepository,
  LangyTurnAccessMemoryRepository,
  LangyTurnHandoffMemoryRepository,
} from "./memory.langy-live-turn.repository.ts";
import { LangyLocalPresenceMemoryRepository } from "./memory.langy-local-presence.repository.ts";
import { LangyTokenBufferMemoryRepository } from "./memory.langy-token-buffer.repository.ts";

/** The "memory" tier: every langy row the app is tested without a datastore. */
export class MemoryLangyRepositories {
  static readonly requires = [] as const;

  static create(): LangyRepositories {
    // One store behind every row, the way one Redis connection serves them: a
    // grant written through `turnAccess` is what `turnAccess` answers with,
    // and a token appended to the buffer is what a follow reads back.
    const store = LangyMemoryStore.create();

    return {
      turnAccess: LangyTurnAccessMemoryRepository.create(store),
      turnHandoff: LangyTurnHandoffMemoryRepository.create(store),
      frameDedup: LangyFrameDedupMemoryRepository.create(store),
      resourceLinks: LangyResourceLinksMemoryRepository.create(store),
      localPresence: LangyLocalPresenceMemoryRepository.create(store),
      tokenBuffer: LangyTokenBufferMemoryRepository.create(store),
    };
  }
}
