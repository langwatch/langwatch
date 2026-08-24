import { createLogger } from "@langwatch/observability";
import type { Where } from "better-auth";
import { mintUserHashKey } from "../crypto/user-hash-key";
import type { IdentityUsersRepository } from "../identity-users.repository";
import type { IdentityCeremonyWrites } from "../identity-writes";
import type { AdapterRows } from "./adapter-rows";
import type {
  IdentityCeremonyClock,
  IdentityWriteGate,
} from "./adapter-types";

const logger = createLogger("langwatch:better-auth:identity-adapter");

/**
 * What a `User` row write MEANS in identity terms (ADR-101 §2, §4): a user
 * created gets the per-user HMAC key their identifier hashes derive from,
 * and a user deleted is an ERASURE.
 *
 * Erasure is not bookkeeping. It is what wipes `Identifier.value` and
 * `identifierHash`, so a bare protocol row delete would leave a deleted
 * user's PII sitting in the projection forever — the backfill finalizes a
 * missing user without cleanup, so nothing downstream would ever come back
 * for it. Latched users run the ceremony BEFORE the row delete, and a
 * vetoed ceremony refuses the protocol write with it.
 *
 * As with the account ceremony, routing is the facade's: this runs only
 * for domain-significant `user` operations.
 */
export class UserCeremony {
  constructor(
    private readonly rows: AdapterRows,
    private readonly users: IdentityUsersRepository,
    private readonly identity: IdentityCeremonyWrites,
    private readonly isLatched: IdentityWriteGate,
    private readonly clock: IdentityCeremonyClock,
  ) {}

  /**
   * Mint the user's `userHashKey`, additively. A sign-up must not fail on
   * it: a user without a key attaches identifiers with null hashes until
   * the backfill (which mints missing keys) reaches them.
   */
  async afterCreate({ userId }: { userId: string }): Promise<void> {
    try {
      await this.users.storeUserHashKeyIfMissing({
        userId,
        userHashKey: mintUserHashKey(),
      });
    } catch (error) {
      logger.warn(
        { userId, error },
        "could not mint userHashKey at user creation; identifier hashes stay null until the backfill mints it",
      );
    }
  }

  /**
   * Erase every latched user the delete covers, and answer the ids the
   * protocol delete must pin itself to. Unlatched users skip the ceremony;
   * the backfill reconciles their rows, exactly as the detach path does.
   */
  async beforeDelete({ where }: { where: Where[] }): Promise<string[]> {
    const rows = await this.rows.findAll<{ id: string }>({
      model: "user",
      where,
    });
    for (const row of rows) {
      await this.eraseFor(row.id);
    }
    return rows.map((row) => row.id);
  }

  private async eraseFor(userId: string): Promise<void> {
    if (!(await this.isLatched({ userId }))) return;
    await this.identity.eraseUser({
      tenantId: userId,
      userId,
      commandId: this.clock.newCommandId(),
      occurredAtMs: this.clock.now(),
      actor: { type: "user", id: userId },
    });
  }
}
