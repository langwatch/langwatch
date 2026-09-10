import {
  GatewayAgentCacheEntryNotFoundError,
  type GatewayAgentCacheWriteInput,
} from "@langwatch/gateway-contract";
import { DEFAULT_AGENT_CACHE_TTL_SECONDS } from "@langwatch/gateway-contract/gateway-agent-cache-schemas";
import { createLogger } from "@langwatch/observability";

import type { GatewayAgentCacheEntryRepository } from "../repositories/gateway-agent-cache.repository.ts";

const logger = createLogger("langwatch:agent-cache");
const AGENT_CACHE_KEY_PREFIX = "ttlcache:agent-cache:";

export interface GatewayAgentCacheEncryption {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export class GatewayAgentCacheService {
  readonly #store: GatewayAgentCacheEntryRepository;
  readonly #encryption: GatewayAgentCacheEncryption;

  static create(options: {
    store: GatewayAgentCacheEntryRepository;
    encryption: GatewayAgentCacheEncryption;
  }): GatewayAgentCacheService {
    return new GatewayAgentCacheService(options.store, options.encryption);
  }

  private constructor(
    store: GatewayAgentCacheEntryRepository,
    encryption: GatewayAgentCacheEncryption,
  ) {
    this.#store = store;
    this.#encryption = encryption;
  }

  async get(input: { projectId: string; name: string }): Promise<{ name: string; value: string }> {
    const encryptedValue = await this.#store.find(this.#key(input));
    if (encryptedValue === undefined) throw new GatewayAgentCacheEntryNotFoundError();

    try {
      return { name: input.name, value: this.#encryption.decrypt(encryptedValue) };
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, name: input.name },
        "Agent cache entry cannot be read back and answers as a miss",
      );
      throw new GatewayAgentCacheEntryNotFoundError({
        reasons: [error instanceof Error ? error : new Error(String(error))],
      });
    }
  }

  async put(input: GatewayAgentCacheWriteInput): Promise<{ name: string; ttl_seconds: number }> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_AGENT_CACHE_TTL_SECONDS;
    await this.#store.set(
      this.#key(input),
      this.#encryption.encrypt(input.value),
      ttlSeconds * 1000,
    );

    return { name: input.name, ttl_seconds: ttlSeconds };
  }

  async claim(
    input: GatewayAgentCacheWriteInput,
  ): Promise<{ name: string; claimed: boolean; ttl_seconds: number }> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_AGENT_CACHE_TTL_SECONDS;
    const claimed = await this.#store.claim(
      this.#key(input),
      this.#encryption.encrypt(input.value),
      ttlSeconds * 1000,
    );

    return { name: input.name, claimed, ttl_seconds: ttlSeconds };
  }

  async delete(input: { projectId: string; name: string }): Promise<void> {
    await this.#store.delete(this.#key(input));
  }

  #key(input: { projectId: string; name: string }): string {
    return `${AGENT_CACHE_KEY_PREFIX}${input.projectId}:${input.name}`;
  }
}
