import type { RedisConnection } from "@langwatch/redis-client";

import type { TakenVoiceNonce, VoiceNonceRepository } from "../voice-nonce.repository.ts";

const VOICE_NONCE_KEY_PREFIX = "scenario_voice_nonce:v1:";

function keyOf(nonce: string): string {
  return `${VOICE_NONCE_KEY_PREFIX}${nonce}`;
}

/** The fleet's media nonces in Redis: SET with a TTL, taken with GETDEL so one taker wins. */
export class RedisVoiceNonceRepository implements VoiceNonceRepository {
  static create(connection: RedisConnection): RedisVoiceNonceRepository {
    return new RedisVoiceNonceRepository(connection);
  }

  private constructor(private readonly connection: RedisConnection) {}

  async store(input: { nonce: string; registration: string; ttlSeconds: number }): Promise<void> {
    await this.connection.set(keyOf(input.nonce), input.registration, "EX", input.ttlSeconds);
  }

  async take(nonce: string): Promise<TakenVoiceNonce> {
    const registration = await this.connection.getdel(keyOf(nonce));
    return registration === null ? { taken: false } : { taken: true, registration };
  }

  async discard(nonce: string): Promise<void> {
    await this.connection.del(keyOf(nonce));
  }
}
