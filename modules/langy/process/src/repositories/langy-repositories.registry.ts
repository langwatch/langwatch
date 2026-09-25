import { defineRepositories } from "@langwatch/kernel";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import type {
  LangyFrameDedupRepository,
  LangyResourceLinksRepository,
  LangyTurnAccessRepository,
  LangyTurnHandoffRepository,
} from "./langy-live-turn.repository.ts";
import type { LangyLocalPresenceRepository } from "./langy-local-presence.repository.ts";
import type {
  LangyTokenBufferConnection,
  LangyTokenBufferRepository,
} from "./langy-token-buffer.repository.ts";
import { MemoryLangyRepositories } from "./memory/memory.langy.repositories.ts";
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
  /**
   * Opens the live edge over one turn's own borrowed connection (ADR-044 part
   * 3): a blocking tail duplicates a connection per stream, so this row is a
   * factory rather than one instance chosen at boot.
   */
  readonly tokenBuffer: {
    open(connection: LangyTokenBufferConnection): LangyTokenBufferRepository;
  };
}

export const langyRepositories = defineRepositories({
  live: PostgresLangyRepositories,
  memory: MemoryLangyRepositories,
});
