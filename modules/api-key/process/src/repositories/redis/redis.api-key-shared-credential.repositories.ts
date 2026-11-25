import {
  RedisSharedCredentialStore,
  type SharedCredentialRedis,
} from "@langwatch/redis-client/shared-credential";
import type { SharedCredentialCipher } from "@langwatch/secrets/shared-credential";

import type { ApiKeyRepositories } from "../api-key.repositories.ts";

/** Main's TtlCache prefix and JSON encoding, so a sandbox token held before a deploy is read. */
const SANDBOX_KEY_PREFIX = "ttlcache:agent-sandbox-key:";
const RUN_KEY_PREFIX = "api-key:run-key:";

/** The sandbox and run tokens every server shares, sealed in Redis (ARCHITECTURE.md §7). */
export class RedisApiKeySharedCredentialRepositories {
  static create({
    redis,
    cipher,
  }: {
    redis: SharedCredentialRedis;
    cipher: SharedCredentialCipher;
  }): Pick<ApiKeyRepositories, "sandboxKeys" | "runKeys"> {
    return {
      sandboxKeys: RedisSharedCredentialStore.create({ redis, cipher, prefix: SANDBOX_KEY_PREFIX }),
      runKeys: RedisSharedCredentialStore.create({ redis, cipher, prefix: RUN_KEY_PREFIX }),
    };
  }
}
