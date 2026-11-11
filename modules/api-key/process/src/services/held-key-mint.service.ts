import { createHash } from "node:crypto";

import type { CreateHeldApiKeyInput } from "@langwatch/api-key-contract";
import type { SharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { Temporal, nowInstant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import { mintSharedKey, stillDisabled, type SharedKeyWriter } from "./shared-key-mint.service.ts";

/**
 * How long a retry should wait after a held key's grant did not land. A try can wait twice (the
 * role's fold, then the binding's), each fold seen to take up to ~50 s, and a landed fold is
 * confirmed at once by the next try: two retries at this pace outlast both.
 */
export const HELD_KEY_GRANT_RETRY_AFTER_MS = 40_000;

/** A held key with less life left than this is minted over, never handed out about to lapse. */
const HELD_KEY_MIN_REMAINING_MS = 60_000;

/**
 * `create` for a caller that is retried: the key is written once per `holdKey` and every retry
 * grants that same key again. A grant that has not landed throws a retryable
 * `AuthzGrantNotConfirmedError` carrying the pace to retry at.
 */
export class HeldKeyMintService {
  static create(options: {
    apiKeys: SharedKeyWriter;
    keys: Pick<ApiKeyRepository, "findLivenessById" | "findById">;
    held: SharedCredentialStore;
  }): HeldKeyMintService {
    return new HeldKeyMintService(options);
  }

  private constructor(
    private readonly options: {
      apiKeys: SharedKeyWriter;
      keys: Pick<ApiKeyRepository, "findLivenessById" | "findById">;
      held: SharedCredentialStore;
    },
  ) {}

  /**
   * The one live key for `holdKey`: minted by the first caller, `created` for that one only. A
   * held key retired since, or held for another identity, is minted over.
   */
  async createHeld({
    holdKey,
    key,
  }: CreateHeldApiKeyInput): Promise<{ token: string; apiKeyId: string; created: boolean }> {
    const { apiKeys, keys, held } = this.options;
    const shared = await mintSharedKey({
      apiKeys,
      store: held,
      address: { tenantId: key.organizationId, contentKey: holdKey },
      identity: identityOf(key),
      newExpiresAt: () => Temporal.Instant.fromEpochMilliseconds(key.expiresAt.getTime()),
      keyFor: () => key,
      reusable: ({ expiresAtMs }) =>
        expiresAtMs - nowInstant().epochMilliseconds >= HELD_KEY_MIN_REMAINING_MS,
      isLive: async (apiKeyId) => {
        const row = await keys.findLivenessById({ id: apiKeyId });
        return (
          row !== null &&
          row.revokedAt === null &&
          (row.expiresAt === null || Temporal.Instant.compare(row.expiresAt, nowInstant()) > 0)
        );
      },
      isPending: stillDisabled(keys),
      retryAfterMs: HELD_KEY_GRANT_RETRY_AFTER_MS,
    });
    return { token: shared.token, apiKeyId: shared.apiKeyId, created: shared.written };
  }

  /** Drops the held entry, so the next caller mints: for a key retired before it expired. */
  release({ organizationId, holdKey }: { organizationId: string; holdKey: string }): Promise<void> {
    return this.options.held.forget({ tenantId: organizationId, contentKey: holdKey });
  }
}

/** Who and what the key is for: a held value never serves a different user, scope or permission. */
function identityOf(key: CreateHeldApiKeyInput["key"]): string {
  return createHash("sha256")
    .update(
      JSON.stringify([key.userId ?? null, key.bindings, [...(key.permissions ?? [])].toSorted()]),
    )
    .digest("hex");
}
