import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import type { OrphanCandidateCursor } from "./orphanSweep.repository";

const logger = createLogger("langwatch:data-retention:orphan-cursor");

/**
 * Persistent cursor for the orphan sweep so a project with more candidates
 * than `MAX_SWEEP_PAGES * CANDIDATE_LIMIT` doesn't restart from the start on
 * every sweep — which would starve any row past the first page when that
 * page stays live. The store is intentionally tiny: load a saved cursor at
 * the start of a run, save the cursor after each page, clear it once every
 * source is drained.
 */
export interface OrphanCursorStore {
  load(projectId: string): Promise<OrphanCandidateCursor | undefined>;
  save(projectId: string, cursor: OrphanCandidateCursor): Promise<void>;
  clear(projectId: string): Promise<void>;
}

/** In-memory store used in tests and when Redis is unavailable; the cursor
 *  resets when the process restarts but at least survives across sweep runs
 *  in the same process. */
export class InMemoryOrphanCursorStore implements OrphanCursorStore {
  private readonly cursors = new Map<string, OrphanCandidateCursor>();

  async load(projectId: string): Promise<OrphanCandidateCursor | undefined> {
    return this.cursors.get(projectId);
  }
  async save(projectId: string, cursor: OrphanCandidateCursor): Promise<void> {
    this.cursors.set(projectId, cursor);
  }
  async clear(projectId: string): Promise<void> {
    this.cursors.delete(projectId);
  }
}

/** Redis-backed store. Keys live for 7 days so a project that goes inactive
 *  doesn't keep a stale cursor forever — the next sweep after the TTL
 *  expires simply starts fresh, same as a brand-new project. */
export class RedisOrphanCursorStore implements OrphanCursorStore {
  private static readonly TTL_SECONDS = 7 * 24 * 60 * 60;

  constructor(private readonly redis: IORedis | Cluster) {}

  private key(projectId: string): string {
    return `data-retention:orphan-sweep:cursor:${projectId}`;
  }

  async load(projectId: string): Promise<OrphanCandidateCursor | undefined> {
    try {
      const raw = await this.redis.get(this.key(projectId));
      if (!raw) return undefined;
      return JSON.parse(raw) as OrphanCandidateCursor;
    } catch (error) {
      logger.warn(
        { projectId, error },
        "Failed to load orphan-sweep cursor; falling back to a fresh sweep",
      );
      return undefined;
    }
  }

  async save(projectId: string, cursor: OrphanCandidateCursor): Promise<void> {
    try {
      await this.redis.set(
        this.key(projectId),
        JSON.stringify(cursor),
        "EX",
        RedisOrphanCursorStore.TTL_SECONDS,
      );
    } catch (error) {
      logger.warn(
        { projectId, error },
        "Failed to persist orphan-sweep cursor; next sweep will restart",
      );
    }
  }

  async clear(projectId: string): Promise<void> {
    try {
      await this.redis.del(this.key(projectId));
    } catch (error) {
      logger.warn(
        { projectId, error },
        "Failed to clear orphan-sweep cursor",
      );
    }
  }
}
