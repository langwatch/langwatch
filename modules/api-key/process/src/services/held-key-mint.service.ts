import { createHash } from "node:crypto";

import type { CreateHeldApiKeyInput } from "@langwatch/api-key-contract";
import type { SharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { Temporal, nowInstant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import { isKeyLive } from "../rules/api-key-held-answer.rules.ts";
import { scopeOf } from "../rules/api-key-own-grant-ids.rules.ts";
import { isRunKeyReusable } from "../rules/run-key.rules.ts";
import type { SharedKeyMintService } from "./shared-key-mint.service.ts";

/**
 * Retry wait after a held key's grant did not land; a try can wait twice (role fold, then binding).
 * Fold lag has no fixed bound. At this pace, 3 retries give at least 120 s, which covered the
 * slowest fold a proof run saw (114 s; langwatch/langwatch#9506). A slower fold fails the run.
 */
export const HELD_KEY_GRANT_RETRY_AFTER_MS = 40_000;

/**
 * `create` for a caller that is retried: the key is written once per `holdKey` and every retry
 * grants that same key again. A grant that has not landed throws a retryable
 * `AuthzGrantNotConfirmedError` carrying the pace to retry at.
 */
export class HeldKeyMintService {
  static create(options: {
    sharedKeys: SharedKeyMintService;
    keys: Pick<ApiKeyRepository, "findLivenessById">;
    held: SharedCredentialStore;
  }): HeldKeyMintService {
    return new HeldKeyMintService(options);
  }

  private constructor(
    private readonly options: {
      sharedKeys: SharedKeyMintService;
      keys: Pick<ApiKeyRepository, "findLivenessById">;
      held: SharedCredentialStore;
    },
  ) {}

  /**
   * The one live key for `holdKey`: minted by the first caller, `created` for that one only. A
   * held key retired since, held for another identity, or with under `minRemainingMs` of life
   * left (never under the reuse margin), is minted over.
   */
  async createHeld({
    holdKey,
    key,
    minRemainingMs,
  }: CreateHeldApiKeyInput): Promise<{ token: string; apiKeyId: string; created: boolean }> {
    const { sharedKeys, keys, held } = this.options;
    const shared = await sharedKeys.mint({
      store: held,
      address: { tenantId: key.organizationId, contentKey: holdKey },
      identity: identityOf(key),
      newExpiresAt: () => Temporal.Instant.fromEpochMilliseconds(key.expiresAt.getTime()),
      keyFor: (expiresAt) => ({ ...key, expiresAt: new Date(expiresAt.epochMilliseconds) }),
      reusable: ({ expiresAtMs }) =>
        isRunKeyReusable({ expiresAtMs, nowMs: nowInstant().epochMilliseconds, minRemainingMs }),
      isLive: async (apiKeyId) => {
        const row = await keys.findLivenessById({ id: apiKeyId });
        return row !== null && isKeyLive({ key: row, now: nowInstant() });
      },
      retryAfterMs: HELD_KEY_GRANT_RETRY_AFTER_MS,
    });
    return { token: shared.token, apiKeyId: shared.apiKeyId, created: shared.written };
  }

  /** Drops the held entry, so the next caller mints: for a key retired before it expired. */
  release({ organizationId, holdKey }: { organizationId: string; holdKey: string }): Promise<void> {
    return this.options.held.forget({ tenantId: organizationId, contentKey: holdKey });
  }
}

/**
 * Who and what the key is for: a held value never serves a different user, scope or permission.
 * Bindings are sorted by `scopeOf`, as the command id is, so a reordered retry keeps its key.
 */
function identityOf(key: CreateHeldApiKeyInput["key"]): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        key.userId ?? null,
        key.bindings.map(scopeOf).toSorted(),
        [...(key.permissions ?? [])].toSorted(),
      ]),
    )
    .digest("hex");
}
