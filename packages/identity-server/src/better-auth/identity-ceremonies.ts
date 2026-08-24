import { identifierProviderFor } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import type { IdentityUsersRepository } from "../identity-users.repository";
import type { IdentityUserGate } from "../identity-user-gate";
import type { IdentityCeremonyWrites } from "../identity-writes";
import type {
  CeremonyAccountRow,
  IdentityAccountCeremonies,
  IdentityCeremonyClock,
} from "./ceremony-types";

const logger = createLogger("langwatch:better-auth:identity-ceremonies");

/** The `User` fields a ceremony reads. */
interface UserRow {
  id?: unknown;
}

/**
 * What a better-auth row write MEANS in identity terms (ADR-101 §2), bound
 * to better-auth's own `databaseHooks`.
 *
 * The app wires three hooks to the three methods here, and better-auth does
 * the rest of the work this used to do by hand:
 *
 *   account.create.before → beforeAccountCreate   attach an identifier
 *   account.delete.before → beforeAccountDelete   detach it
 *   user.delete.before    → beforeUserDelete      erase the user
 *
 * All three are GATED: an unlatched user's hook returns having done nothing
 * and written nothing, so an organization nobody has enrolled behaves
 * exactly as it did before any of this existed. There is deliberately no
 * `user.create` hook — the `userHashKey` mint (ADR-101 §4) used to live
 * there, ungated, which made a sign-up on an unmigrated organization write
 * a column it otherwise would not have. The backfill mints the key for
 * every user it adopts, before it attaches anything, so nothing was gained
 * by minting early.
 *
 * `before` runs while no row exists, so a guard that refuses refuses the row
 * write with it — the veto-before-write contract, unchanged. better-auth
 * resolves the row for the delete hooks itself (and fires them per row on a
 * `deleteMany`, where one refusal vetoes the batch), and it always calls the
 * adapter with `forceAllowId: true`, so returning `{ data: { id } }` from
 * the create hook is what pins the `Account` row's id.
 *
 * That last point is load-bearing rather than cosmetic. The live attach must
 * derive the SAME identifier id the backfill will later derive from the row
 * (ADR-101 §3): the id is a function of `(userId, provider,
 * providerAccountId, value, occurredAt)`, and the backfill reads
 * `occurredAt` from `Account.createdAt` and links by `Account.id`. So the
 * ceremony mints the row's id up front and takes the row's own `createdAt`,
 * and live emission and adoption converge on one projection row.
 *
 * This replaced a routing facade over better-auth's `database` adapter,
 * which reached the same events one layer lower — below intent, where a
 * ceremony had to be reverse-engineered from a row bag, deletes had to be
 * pinned to pre-selected ids, `findMany` had to be paged around its silent
 * 100-row default, and writes inside a transaction could only be logged.
 * ADR-101 §Rationale weighed hooks and rejected them, but the shape it
 * rejected was *endpoint* hooks firing AFTER the row write; the database
 * hooks used here fire before it and can refuse.
 */
export class IdentityCeremonies implements IdentityAccountCeremonies {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly users: IdentityUsersRepository,
    private readonly identity: IdentityCeremonyWrites,
    private readonly isLatched: IdentityUserGate,
    private readonly clock: IdentityCeremonyClock,
  ) {}

  /**
   * An `Account` row is about to be created: attach the identifier it
   * carries. Answers the row data better-auth must write — the same data
   * with the id this ceremony pinned — or nothing, when no ceremony ran.
   */
  async beforeAccountCreate(
    account: CeremonyAccountRow,
  ): Promise<{ data: { id: string } } | undefined> {
    const { userId, providerId } = account;
    if (typeof userId !== "string" || typeof providerId !== "string") return;
    if (!(await this.isLatched({ userId }))) return;

    const value = await this.users.findEmail({ userId });
    if (!value) {
      logger.warn(
        { userId, providerId },
        "latched user's account ceremony carries no email value; no identifier attached",
      );
      return;
    }
    // Minted the same way the schema's own `@default(nanoid())` would mint
    // it; better-auth persists a hook-supplied id (forceAllowId is always on
    // for creates), and the backfill links the identifier by this id.
    const accountRowId =
      typeof account.id === "string" ? account.id : nanoid();
    await this.identity.attachIdentifier({
      tenantId: userId,
      userId,
      commandId: this.clock.newCommandId(),
      accountId: accountRowId,
      provider: identifierProviderFor(providerId),
      providerAccountId:
        typeof account.accountId === "string" ? account.accountId : null,
      value,
      occurredAtMs:
        account.createdAt instanceof Date
          ? account.createdAt.getTime()
          : this.clock.now(),
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: userId },
    });
    return { data: { id: accountRowId } };
  }

  /** An `Account` row is about to be deleted: detach what it mirrors. */
  async beforeAccountDelete(account: CeremonyAccountRow): Promise<void> {
    const { id, userId, providerId } = account;
    if (
      typeof id !== "string" ||
      typeof userId !== "string" ||
      typeof providerId !== "string"
    ) {
      return;
    }
    if (!(await this.isLatched({ userId }))) return;
    const identifierId = await this.heads.findIdentifierIdForAccount({
      userId,
      accountId: id,
      provider: identifierProviderFor(providerId),
    });
    if (identifierId === null) {
      // Nothing in the projection mirrors this row (adopted before the
      // projection carried accountIds, or ambiguous). The row delete must
      // still happen; the backfill's next pass detaches whatever the row's
      // absence implies.
      logger.warn(
        { userId, accountId: id, providerId },
        "no unambiguous Identifier mirrors the Account row being deleted; delete proceeds, the backfill reconciles",
      );
      return;
    }
    await this.identity.detachIdentifier({
      tenantId: userId,
      userId,
      commandId: this.clock.newCommandId(),
      identifierId,
      occurredAtMs: this.clock.now(),
      actor: { type: "user", id: userId },
    });
  }

  /**
   * A `User` row is about to be deleted: erase them. Erasure is what wipes
   * `Identifier.value` and `identifierHash`, so a bare row delete would
   * leave a deleted user's PII in the projection forever — the backfill
   * finalizes a missing user without cleanup, so nothing comes back for it.
   * Unlatched users skip; the backfill reconciles their rows.
   */
  async beforeUserDelete(user: UserRow): Promise<void> {
    const { id } = user;
    if (typeof id !== "string") return;
    if (!(await this.isLatched({ userId: id }))) return;
    await this.identity.eraseUser({
      tenantId: id,
      userId: id,
      commandId: this.clock.newCommandId(),
      occurredAtMs: this.clock.now(),
      actor: { type: "user", id },
    });
  }
}
