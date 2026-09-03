import { createLogger } from "@langwatch/observability";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { DEFAULT_TTL_SECONDS } from "./agent-cache-rest";
import { CacheEntryNotFoundError } from "./agent-cache.errors";
import { AgentCacheRepository, type AgentCacheEntryStorePort } from "./agent-cache.repository";

const logger = createLogger("langwatch:agent-cache");

export type CacheEntry = { name: string; value: string };

export class AgentCacheService {
  private readonly repository: AgentCacheRepository;

  /**
   * The cipher and the expiring store both arrive from the process.
   *
   * The platform application reached two module singletons for them — its own
   * `encrypt`/`decrypt` and a self-registering TTL cache — which is what made
   * one process's entries readable from another's tests. Injecting both keeps
   * an entry written under this deployment's key readable only here.
   */
  constructor(
    store: AgentCacheEntryStorePort,
    private readonly encryption: SecretEncryptionPort,
  ) {
    this.repository = new AgentCacheRepository(store);
  }

  /**
   * Read an entry. Every empty answer is one refusal, including a stored
   * value the platform can no longer open: the key that wrote it is gone, so
   * the caller produces the value again exactly as they would after an
   * expiry.
   */
  async getByName({ projectId, name }: { projectId: string; name: string }): Promise<CacheEntry> {
    const encryptedValue = await this.repository.findByName({
      projectId,
      name,
    });
    if (encryptedValue === undefined) {
      throw new CacheEntryNotFoundError();
    }

    try {
      return { name, value: this.encryption.decrypt(encryptedValue) };
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
      encryptedValue: this.encryption.encrypt(value),
      ttlMs: lifetimeSeconds * 1000,
    });

    return { name, ttl_seconds: lifetimeSeconds };
  }

  /**
   * Take a name, but only if the project does not hold it yet.
   *
   * This is what one row uses to do work the other rows then reuse. Losing is
   * an ordinary answer rather than a refusal: the caller reads `claimed` and
   * either does the work or reads back what the winner stored, so agent code
   * branches on a boolean instead of catching an exception.
   */
  async claim({
    projectId,
    name,
    value,
    ttlSeconds,
  }: {
    projectId: string;
    name: string;
    value: string;
    ttlSeconds?: number;
  }): Promise<{ name: string; claimed: boolean; ttl_seconds: number }> {
    const lifetimeSeconds = ttlSeconds ?? DEFAULT_TTL_SECONDS;

    const claimed = await this.repository.claim({
      projectId,
      name,
      encryptedValue: this.encryption.encrypt(value),
      ttlMs: lifetimeSeconds * 1000,
    });

    return { name, claimed, ttl_seconds: lifetimeSeconds };
  }

  /** Idempotent: a name the project does not hold deletes nothing and is not
   * an error, so a caller can clear an entry without reading it first. */
  async delete({ projectId, name }: { projectId: string; name: string }): Promise<void> {
    await this.repository.delete({ projectId, name });
  }
}
