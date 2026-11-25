import {
  SharedCredentialStore,
  SharedCredentialUnreadableError,
  sharedCredentialKey,
  type SharedCredentialAddress,
  type SharedCredentialCipher,
  type SharedCredentialClaim,
  type SharedCredentialHold,
} from "@langwatch/secrets/shared-credential";
import type { Cluster, Redis } from "ioredis";

const RELEASE_IF_OWNED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Only what the Redis store calls. */
export type SharedCredentialRedis = Pick<Redis | Cluster, "get" | "set" | "del" | "eval">;

/**
 * The live store behind `mintOnce` (`@langwatch/secrets/shared-credential`, ARCHITECTURE.md §7):
 * values under `prefix`, each sealed with the cipher, stored as a JSON string and expiring with
 * the write; a claim sits beside its value under `:claim`. Built in `repositories/redis/` only.
 */
export class RedisSharedCredentialStore extends SharedCredentialStore {
  private constructor(
    private readonly redis: SharedCredentialRedis,
    private readonly cipher: SharedCredentialCipher,
    private readonly prefix: string,
  ) {
    super();
  }

  static create({
    redis,
    cipher,
    prefix,
  }: {
    redis: SharedCredentialRedis;
    cipher: SharedCredentialCipher;
    prefix: string;
  }): RedisSharedCredentialStore {
    return new RedisSharedCredentialStore(redis, cipher, prefix);
  }

  async find(address: SharedCredentialAddress): Promise<string[]> {
    const stored = await this.redis.get(this.#key(address));
    if (stored === null) return [];
    try {
      const sealed: unknown = JSON.parse(stored);
      if (typeof sealed !== "string") throw new TypeError("the held value is not a sealed string");
      return [this.cipher.decrypt(sealed)];
    } catch (error) {
      throw new SharedCredentialUnreadableError({ cause: error });
    }
  }

  async claim({
    address,
    ttlMs,
  }: {
    address: SharedCredentialAddress;
    ttlMs: number;
  }): Promise<SharedCredentialClaim[]> {
    const token = globalThis.crypto.randomUUID();
    const claimKey = `${this.#key(address)}:claim`;
    const taken = await this.redis.set(claimKey, token, "PX", whole(ttlMs), "NX");
    return taken === null ? [] : [{ token }];
  }

  async hold({
    address,
    value,
    ttlMs,
  }: { address: SharedCredentialAddress } & SharedCredentialHold): Promise<void> {
    const sealed = JSON.stringify(this.cipher.encrypt(value));
    await this.redis.set(this.#key(address), sealed, "PX", whole(ttlMs));
  }

  async release({
    address,
    claim,
  }: {
    address: SharedCredentialAddress;
    claim: SharedCredentialClaim;
  }): Promise<void> {
    await this.redis.eval(RELEASE_IF_OWNED_SCRIPT, 1, `${this.#key(address)}:claim`, claim.token);
  }

  async forget(address: SharedCredentialAddress): Promise<void> {
    await this.redis.del(this.#key(address));
  }

  #key(address: SharedCredentialAddress): string {
    return sharedCredentialKey({ prefix: this.prefix, address });
  }
}

function whole(ttlMs: number): number {
  return Math.max(1, Math.floor(ttlMs));
}
