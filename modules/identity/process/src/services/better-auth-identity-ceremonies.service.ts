import { HandledError } from "@langwatch/handled-error";
import { identifierProviderFor } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";

import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository.ts";
import { issuerForProviderId } from "../rules/better-auth-account-queries.rules.ts";
import type {
  CeremonyAccountPin,
  CeremonyAccountRow,
  IdentityAccountCeremonies,
  IdentityCeremonyClock,
} from "../rules/ceremony-types.rules.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";
import type { IdentityCeremonyWrites } from "../rules/identity-writes.rules.ts";

const logger = createLogger("langwatch:better-auth:identity-ceremonies");

/** The `User` fields a ceremony reads. */
interface UserRow {
  id?: unknown;
}

/**
 * What a better-auth row write MEANS in identity terms (ADR-101): hooks stay
 * GATED no-ops until latch, and the create hook pins the row's id via
 * `forceAllowId: true` so live attach and the backfill derive the same id.
 */
export class IdentityCeremoniesService implements IdentityAccountCeremonies {
  static create({
    heads,
    users,
    identity,
    isLatched,
    clock,
  }: {
    heads: IdentityHeadsRepository;
    users: IdentityUsersRepository;
    identity: IdentityCeremonyWrites;
    isLatched: IdentityUserGate;
    clock: IdentityCeremonyClock;
  }): IdentityCeremoniesService {
    return new IdentityCeremoniesService({ heads, users, identity, isLatched, clock });
  }

  private readonly heads: IdentityHeadsRepository;
  private readonly users: IdentityUsersRepository;
  private readonly identity: IdentityCeremonyWrites;
  private readonly isLatched: IdentityUserGate;
  private readonly clock: IdentityCeremonyClock;

  private constructor({
    heads,
    users,
    identity,
    isLatched,
    clock,
  }: {
    heads: IdentityHeadsRepository;
    users: IdentityUsersRepository;
    identity: IdentityCeremonyWrites;
    isLatched: IdentityUserGate;
    clock: IdentityCeremonyClock;
  }) {
    this.heads = heads;
    this.users = users;
    this.identity = identity;
    this.isLatched = isLatched;
    this.clock = clock;
  }

  /**
   * An `Account` row is about to be created: attach the identifier it
   * carries. Answers the id this ceremony pinned for better-auth to write,
   * or `pinned: false` when no ceremony ran.
   */
  async createAccountIdentifier(account: CeremonyAccountRow): Promise<CeremonyAccountPin> {
    const { userId, providerId } = account;
    if (typeof userId !== "string" || typeof providerId !== "string") return { pinned: false };
    if (!(await this.isLatched({ userId }))) return { pinned: false };

    const { email: value } = await this.users.getUserEmail({ userId }).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "user_not_found") return { email: null };
      throw error;
    });
    if (!value) {
      logger.warn(
        { userId, providerId },
        "latched user's account ceremony carries no email value; no identifier attached",
      );
      return { pinned: false };
    }
    // Minted the same way the schema's own `@default(nanoid())` would mint
    // it; better-auth persists a hook-supplied id (forceAllowId is always on
    // for creates), and the backfill links the identifier by this id.
    const accountRowId = typeof account.id === "string" ? account.id : nanoid();
    await this.identity.attachIdentifier({
      tenantId: userId,
      userId,
      commandId: this.clock.newCommandId(),
      accountId: accountRowId,
      provider: identifierProviderFor(providerId),
      // better-auth's own id, unfolded: the projected `Account` row is keyed
      // by it, and `provider` above cannot answer for it.
      providerId,
      // Verbatim from the row better-auth was about to write, so the fact records the issuer
      // the library ITSELF keyed this account by rather than one we reconstructed. It falls
      // back to the derivation only for a caller that predates 1.7 and names none — never in
      // preference to an issuer better-auth stated, because a real OIDC connection's is its own
      // and no rule of ours would arrive at it.
      issuer:
        typeof account.issuer === "string" && account.issuer.length > 0
          ? account.issuer
          : issuerForProviderId(providerId),
      providerAccountId: typeof account.accountId === "string" ? account.accountId : null,
      value,
      occurredAtMs:
        account.createdAt instanceof Date ? account.createdAt.getTime() : this.clock.now(),
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: userId },
    });
    return { pinned: true, data: { id: accountRowId } };
  }

  /**
   * A latched user's email is being changed: state it, never write it. The address arrives as
   * an ATTACHED identifier — unverified, and therefore not yet `User.email`, which is the
   * honest answer: nobody has proved this mailbox.
   */
  async beforeEmailChange({ userId, email }: { userId: string; email: string }): Promise<void> {
    if (!(await this.isLatched({ userId }))) return;
    await this.identity.attachIdentifier({
      tenantId: userId,
      userId,
      commandId: this.clock.newCommandId(),
      accountId: null,
      provider: "email",
      providerId: null,
      issuer: null,
      providerAccountId: null,
      value: email,
      occurredAtMs: this.clock.now(),
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: userId },
    });
  }

  /** An `Account` row is about to be deleted: detach what it mirrors. */
  async beforeAccountDelete(account: CeremonyAccountRow): Promise<void> {
    const { id, userId, providerId } = account;
    if (typeof id !== "string" || typeof userId !== "string" || typeof providerId !== "string") {
      return;
    }
    if (!(await this.isLatched({ userId }))) return;
    const identifierId = await this.heads
      .getIdentifierIdForAccount({
        userId,
        accountId: id,
        // better-auth's own id, verbatim: the fallback inside must not match
        // across two enterprise IdPs that fold to one vocabulary.
        providerId,
      })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "identity_identifier_not_found")
          return null;
        throw error;
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
   * A `User` row is about to be deleted: erase them.
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
