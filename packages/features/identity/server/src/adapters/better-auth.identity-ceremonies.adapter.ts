import { identifierProviderFor } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules";
import type { IdentityCeremonyWrites } from "../rules/identity-writes.rules";
import { BetterAuthAccountQueriesAdapter } from "./better-auth.account-queries.adapter";
import type {
  CeremonyAccountRow,
  IdentityAccountCeremonies,
  IdentityCeremonyClock,
} from "../rules/ceremony-types.rules";

const logger = createLogger("langwatch:better-auth:identity-ceremonies");

/**
 * The account ceremonies as better-auth's `databaseHooks` bind them once the
 * identity storage adapter is live (ADR-116 §5).
 */
export class BetterAuthCeremonyBridgeAdapter implements Pick<
  IdentityAccountCeremonies,
  "tryBeforeAccountCreate" | "beforeAccountDelete"
> {
  static create(deps: {
    ceremonies: IdentityAccountCeremonies;
    routesToIdentity: IdentityUserGate;
  }): BetterAuthCeremonyBridgeAdapter {
    return new BetterAuthCeremonyBridgeAdapter(deps);
  }

  private constructor(
    private readonly deps: {
      ceremonies: IdentityAccountCeremonies;
      routesToIdentity: IdentityUserGate;
    },
  ) {}

  async tryBeforeAccountCreate(
    account: Parameters<IdentityAccountCeremonies["tryBeforeAccountCreate"]>[0],
  ): ReturnType<IdentityAccountCeremonies["tryBeforeAccountCreate"]> {
    if (await this.deferred(account.userId)) return;

    return this.deps.ceremonies.tryBeforeAccountCreate(account);
  }

  async beforeAccountDelete(
    account: Parameters<IdentityAccountCeremonies["beforeAccountDelete"]>[0],
  ): Promise<void> {
    if (await this.deferred(account.userId)) return;
    await this.deps.ceremonies.beforeAccountDelete(account);
  }

  private async deferred(userId: unknown): Promise<boolean> {
    return typeof userId === "string" && (await this.deps.routesToIdentity({ userId }));
  }
}

/** The `User` fields a ceremony reads. */
interface UserRow {
  id?: unknown;
}

/**
 * What a better-auth row write MEANS in identity terms (ADR-101): hooks stay
 * GATED no-ops until latch, and the create hook pins the row's id via
 * `forceAllowId: true` so live attach and the backfill derive the same id.
 */
export class IdentityCeremoniesAdapter implements IdentityAccountCeremonies {
  static create(
    heads: IdentityHeadsRepository,
    users: IdentityUsersRepository,
    identity: IdentityCeremonyWrites,
    isLatched: IdentityUserGate,
    clock: IdentityCeremonyClock,
  ): IdentityCeremoniesAdapter {
    return new IdentityCeremoniesAdapter(heads, users, identity, isLatched, clock);
  }

  private constructor(
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
  async tryBeforeAccountCreate(
    account: CeremonyAccountRow,
  ): Promise<{ data: { id: string } } | undefined> {
    const { userId, providerId } = account;
    if (typeof userId !== "string" || typeof providerId !== "string") return;
    if (!(await this.isLatched({ userId }))) return;

    const value = await this.users.tryFindEmail({ userId });
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
          : BetterAuthAccountQueriesAdapter.issuerForProviderId(providerId),
      providerAccountId: typeof account.accountId === "string" ? account.accountId : null,
      value,
      occurredAtMs:
        account.createdAt instanceof Date ? account.createdAt.getTime() : this.clock.now(),
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: userId },
    });
    return { data: { id: accountRowId } };
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
    const identifierId = await this.heads.tryFindIdentifierIdForAccount({
      userId,
      accountId: id,
      // better-auth's own id, verbatim: the fallback inside must not match
      // across two enterprise IdPs that fold to one vocabulary.
      providerId,
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
