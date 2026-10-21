import type { SharedCredentialStore } from "@langwatch/secrets/shared-credential";

import type { ApiKeyAnswerCacheRepository } from "./api-key-answer-cache.repository.ts";
import type { ApiKeyRepository } from "./api-key.repository.ts";
import type { SigningKeyUsageRepository } from "./signing-key-usage.repository.ts";
import type { SigningKeyRepository } from "./signing-key.repository.ts";

/**
 * The persistence one API-key application is built over. One aggregate,
 * one repository: a key and its role bindings are read and written
 * together, so splitting them would just be two objects saying the same thing.
 */
export interface ApiKeyRepositories {
  readonly apiKeys: ApiKeyRepository;
  /** The token answers every pod shares; Postgres stays the truth. */
  readonly answers: ApiKeyAnswerCacheRepository;
  /** The token each project's code agent runs share, sealed at rest on the live tier. */
  readonly sandboxKeys: SharedCredentialStore;
  /** Each run's key, minted once across every server and shared sealed until it expires. */
  readonly runKeys: SharedCredentialStore;
  /** Braid signing keys, the secret sealed at rest on the live tier (ADR-183 §4). */
  readonly signingKeys: SigningKeyRepository;
  /** Each signing key's passed and failed signatures per hour, shared by every pod. */
  readonly signingKeyUsage: SigningKeyUsageRepository;
}
