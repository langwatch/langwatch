import { createLogger } from "@langwatch/observability";
import { decrypt, encrypt } from "~/utils/encryption";
import { CacheEntryNotFoundError } from "./agent-cache.errors";
import { AgentCacheRepository } from "./agent-cache.repository";

const logger = createLogger("langwatch:agent-cache");

/** How long an entry lives when the caller names no lifetime. */
export const DEFAULT_TTL_SECONDS = 15 * 60;
/** Below this an entry expires before a second row can read it. */
export const MIN_TTL_SECONDS = 5;
/** A day. Anything a run needs for longer belongs in a secret or a dataset. */
export const MAX_TTL_SECONDS = 24 * 60 * 60;
/** 32 KB, which holds a session envelope and refuses a payload. */
export const MAX_VALUE_BYTES = 32 * 1024;
/** Same shape as an environment variable name, so agent code reads the same. */
export const CACHE_ENTRY_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
export const MAX_NAME_LENGTH = 64;

export type CacheEntry = { name: string; value: string };

export class AgentCacheService {
  private readonly repository: AgentCacheRepository;

  constructor() {
    this.repository = new AgentCacheRepository({
      defaultTtlMs: DEFAULT_TTL_SECONDS * 1000,
    });
  }

  /**
   * Read an entry. Every empty answer is one refusal, including a stored
   * value the platform can no longer open: the key that wrote it is gone, so
   * the caller produces the value again exactly as they would after an
   * expiry.
   */
  async getByName({
    projectId,
    name,
  }: {
    projectId: string;
    name: string;
  }): Promise<CacheEntry> {
    const encryptedValue = await this.repository.findByName({
      projectId,
      name,
    });
    if (encryptedValue === undefined) {
      throw new CacheEntryNotFoundError();
    }

    try {
      return { name, value: decrypt(encryptedValue) };
    } catch {
      // The entry, never the value: the value is the thing this line must
      // not put in a log. The name and the project are what an operator
      // needs to see that a key rotation is behind a wave of fresh work.
      logger.warn(
        { projectId, name },
        "Agent cache entry cannot be read back and answers as a miss",
      );
      throw new CacheEntryNotFoundError();
    }
  }

  async put({
    projectId,
    name,
    value,
    ttlSeconds,
  }: {
    projectId: string;
    name: string;
    value: string;
    ttlSeconds?: number;
  }): Promise<{ name: string; ttl_seconds: number }> {
    const lifetimeSeconds = ttlSeconds ?? DEFAULT_TTL_SECONDS;

    await this.repository.put({
      projectId,
      name,
      encryptedValue: encrypt(value),
      ttlMs: lifetimeSeconds * 1000,
    });

    return { name, ttl_seconds: lifetimeSeconds };
  }

  /** Idempotent: a name the project does not hold deletes nothing and is not
   * an error, so a caller can clear an entry without reading it first. */
  async delete({
    projectId,
    name,
  }: {
    projectId: string;
    name: string;
  }): Promise<void> {
    await this.repository.delete({ projectId, name });
  }
}
