import { defineRepositories } from "@langwatch/runtime-composition";
import type {
  LangyFrameDedupRepository,
  LangyResourceLinksRepository,
  LangyTurnAccessPort,
  LangyTurnHandoffPort,
} from "./langy-live-turn.repository.ts";
import type { LangyLocalPresencePort } from "./langy-local-presence.repository.ts";
import type {
  LangyTokenBufferConnection,
  LangyTokenBufferPort,
} from "./langy-token-buffer.repository.ts";
import { MemoryLangyRepositories } from "./memory/memory.langy.repositories.ts";
import { PostgresLangyRepositories } from "./prisma/prisma.langy.repositories.ts";

/**
 * The rows the langy module keeps outside its own event log, chosen once at
 * boot: who may watch a turn, what a worker picks it up from, the frames
 * already seen, the links a navigate resolves, which folder is shared and the
 * live token edge. Redis holds every one of them in a deployment that has
 * Redis; the memory tier holds them in a process that does not.
 */
export interface LangyRepositories {
  readonly turnAccess: LangyTurnAccessPort;
  readonly turnHandoff: LangyTurnHandoffPort;
  readonly frameDedup: LangyFrameDedupRepository;
  readonly resourceLinks: LangyResourceLinksRepository;
  readonly localPresence: LangyLocalPresencePort;
  /**
   * Opens the live edge over one turn's own borrowed connection (ADR-044 part
   * 3): a blocking tail duplicates a connection per stream, so this row is a
   * factory rather than one instance chosen at boot.
   */
  readonly tokenBuffer: { open(connection: LangyTokenBufferConnection): LangyTokenBufferPort };
}

export const langyRepositories = defineRepositories({
  postgres: PostgresLangyRepositories,
  memory: MemoryLangyRepositories,
});
