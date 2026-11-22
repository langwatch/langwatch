import {
  RedisSharedCredentialStore,
  type SharedCredentialRedis,
} from "@langwatch/redis-client/shared-credential";
import type {
  SharedCredentialCipher,
  SharedCredentialStore,
} from "@langwatch/secrets/shared-credential";

/** Each held pair sits under a digest of the refresh token it rotated, its claim beside it. */
const ROTATION_REPLAY_PREFIX = "lwcli:refresh-replay:";

/**
 * Where a refresh token's one rotation is claimed and its pair shared, sealed with the stores'
 * `encryption` client (ARCHITECTURE.md §7).
 */
export class RedisCliRotationReplayRepository {
  static create({
    redis,
    encryption,
  }: {
    redis: SharedCredentialRedis;
    encryption: SharedCredentialCipher;
  }): SharedCredentialStore {
    return RedisSharedCredentialStore.create({
      redis,
      cipher: encryption,
      prefix: ROTATION_REPLAY_PREFIX,
    });
  }
}
