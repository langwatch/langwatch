import { ApiKeyAlreadyRevokedError } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";
import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";

const logger = createLogger("langwatch:api-key:cli-login-key-reaper");

/**
 * A session the CLI stops refreshing leaves Redis by TTL, which runs no
 * code — this sweep retires its login key and, via the revoke cascade,
 * its ingest keys. Each is revoked one at a time; only the read crosses orgs.
 */
export class CliLoginKeyReapService {
  static create(options: {
    repository: ApiKeyRepository;
    revoke: (input: {
      id: string;
      organizationId: string;
      userId: string;
    }) => Promise<unknown>;
    now?: () => Instant;
  }): CliLoginKeyReapService {
    return new CliLoginKeyReapService(options.repository, options.revoke, options.now ?? nowInstant);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly revokeKey: (input: {
      id: string;
      organizationId: string;
      userId: string;
    }) => Promise<unknown>,
    private readonly now: () => Instant,
  ) {}

  /**
   * Revokes every elapsed, unrevoked CLI login key and answers how many. A
   * row with no `userId` is skipped: a login key is always minted for a
   * user, so it can't be revoked as one — it would only repeat as a warning.
   */
  async reap(): Promise<number> {
    const now = this.now();
    const elapsed = await this.repository.findElapsedLoginKeys({ now });

    let count = 0;
    for (const key of elapsed) {
      if (!key.userId) continue;
      try {
        await this.revokeKey({
          id: key.id,
          organizationId: key.organizationId,
          userId: key.userId,
        });
        count += 1;
      } catch (err) {
        if (ApiKeyAlreadyRevokedError.is(err)) continue;
        logger.warn(
          { err, apiKeyId: key.id, organizationId: key.organizationId },
          "could not revoke an expired CLI login key",
        );
      }
    }

    if (count > 0) {
      logger.info({ count }, "reaped expired CLI login keys");
    }

    return count;
  }
}
