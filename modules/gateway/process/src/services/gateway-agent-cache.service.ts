import {
  GatewayAgentCacheEntryNotFoundError,
  type GatewayAgentCacheWriteInput,
} from "@langwatch/gateway-contract";
import { DEFAULT_AGENT_CACHE_TTL_SECONDS } from "@langwatch/gateway-contract/gateway-agent-cache-schemas";
import { createLogger } from "@langwatch/observability";

import {
  GatewayAgentCacheEntryUnreadableError,
  type GatewayAgentCacheEntryRepository,
} from "../repositories/gateway-agent-cache.repository.ts";

const logger = createLogger("langwatch:agent-cache");
const AGENT_CACHE_KEY_PREFIX = "ttlcache:agent-cache:";

export class GatewayAgentCacheService {
  readonly #store: GatewayAgentCacheEntryRepository;

  static create(options: { store: GatewayAgentCacheEntryRepository }): GatewayAgentCacheService {
    return new GatewayAgentCacheService(options.store);
  }

  private constructor(store: GatewayAgentCacheEntryRepository) {
    this.#store = store;
  }

  async get(input: { projectId: string; name: string }): Promise<{ name: string; value: string }> {
    const value = await this.#readable(input);
    if (value === undefined) throw new GatewayAgentCacheEntryNotFoundError();

    return { name: input.name, value };
  }

  async put(input: GatewayAgentCacheWriteInput): Promise<{ name: string; ttl_seconds: number }> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_AGENT_CACHE_TTL_SECONDS;
    await this.#store.set(this.#key(input), input.value, ttlSeconds * 1000);

    return { name: input.name, ttl_seconds: ttlSeconds };
  }

  async claim(
    input: GatewayAgentCacheWriteInput,
  ): Promise<{ name: string; claimed: boolean; ttl_seconds: number }> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_AGENT_CACHE_TTL_SECONDS;
    const claimed = await this.#store.claim(this.#key(input), input.value, ttlSeconds * 1000);

    return { name: input.name, claimed, ttl_seconds: ttlSeconds };
  }

  async delete(input: { projectId: string; name: string }): Promise<void> {
    await this.#store.delete(this.#key(input));
  }

  /** An entry the store can no longer open answers as a miss, its value kept out of the log. */
  async #readable(input: { projectId: string; name: string }): Promise<string | undefined> {
    try {
      return await this.#store.find(this.#key(input));
    } catch (error) {
      if (!(error instanceof GatewayAgentCacheEntryUnreadableError)) throw error;

      logger.warn(
        { projectId: input.projectId, name: input.name },
        "Agent cache entry cannot be read back and answers as a miss",
      );
      const { cause } = error;
      throw new GatewayAgentCacheEntryNotFoundError({
        reasons: [cause instanceof Error ? cause : new Error(String(cause))],
      });
    }
  }

  #key(input: { projectId: string; name: string }): string {
    return `${AGENT_CACHE_KEY_PREFIX}${input.projectId}:${input.name}`;
  }
}
