import {
  type AttachIdentifierCommandData,
  arrivalStateForProvider,
  type DetachIdentifierCommandData,
  type EraseUserCommandData,
  IdentityEmailInUseError,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentifierArrivalState,
  IdentityDetachStrandsUserError,
  type IdentityHeads,
  IdentityIdentifierNotFoundError,
  IdentityIdentifierNotVerifiableError,
  IdentityPrimaryMustDemoteFirstError,
  IdentityPrimaryRequiresVerifiedError,
  type IdentityFactInput,
  identifierDomain,
  LINK_PROPOSED_EVENT_TYPE,
  type MarkPrimaryCommandData,
  normalizeIdentifierValue,
  primaryChangeFacts,
  type ProposeLinkCommandData,
  userErasureFacts,
  type VerifyIdentifierCommandData,
} from "@langwatch/identity";
import {
  computeIdentifierHash,
  deriveIdentifierId,
} from "./crypto/identifier-identity";
import type { IdentityHeadsRepository } from "./identity-heads.repository";
import type { IdentityReservationRepository } from "./identity-reservations.repository";
import type { IdentityUsersRepository } from "./identity-users.repository";

/**
 * Why removing this identifier would strand the person, or null.
 *
 * Pure over the heads, and exported, because two callers need the SAME
 * answer and only one of them is about to write: the detach guard refuses
 * with it, and the settings surface stands its Remove control down with it
 * before anybody clicks (`specs/identity/authentication-settings.feature`).
 * A screen that predicted the refusal with a rule of its own would be a
 * second implementation of the invariant, and the two would drift — the
 * screen would either offer a click that always fails or hide one that would
 * have worked.
 *
 * Scoped to identifiers that are actually usable, which is what makes an
 * unconfirmed address removable: nobody could have signed in with it, so
 * losing it strands nobody. The subject's own state is deliberately NOT read
 * here — the question is what is LEFT — so it answers the same for a VERIFIED
 * identifier and for the PRIMARY one, which is what lets the surface reason
 * about a removal that demotes first.
 */
export function detachStrandsUser({
  heads,
  identifierId,
}: {
  heads: IdentityHeads;
  identifierId: string;
}): IdentityDetachStrandsUserError | null {
  const remaining = Object.values(heads.identifiers).filter(
    (candidate) =>
      candidate.identifierId !== identifierId &&
      (candidate.state === "VERIFIED" || candidate.state === "PRIMARY"),
  );
  if (remaining.length === 0) {
    return new IdentityDetachStrandsUserError(
      `detach_identifier: ${identifierId} is the last verified identifier for this user`,
    );
  }
  // A passkey is a way in and not a way back: it has no address, so a person
  // holding only passkeys has nowhere a recovery message could reach them.
  // The remedy the screen offers is a verified email.
  if (remaining.every((candidate) => candidate.provider === "passkey")) {
    return new IdentityDetachStrandsUserError(
      `detach_identifier: removing ${identifierId} would leave this user with passkeys only and no recovery address`,
    );
  }
  return null;
}

/**
 * The identity guards (ADR-101 §2): what runs BEFORE any fact exists — the
 * veto-before-write half of the adapter contract. Each verb reads the heads,
 * refuses what the state machine forbids, and states only what the heads do
 * not already carry (PR #7429: the store's dedupe is read-side, so a
 * restated fact is still a row written).
 *
 * One implementation, two callers: `IdentityService` on the calling path
 * and the app's pipeline command handlers on the staged re-run, so the
 * guard that vetoes a live ceremony is the one the queue's re-run applies.
 * Facts come back without their envelope; the ledger stamps business time,
 * tenancy and idempotency from the command that produced them.
 *
 * THREE repositories, because uniqueness spans two populations and a race
 * (ADR-116 §6). The heads answer for latched users; `User.email` answers for
 * everyone the identity branch has not adopted yet — a guard that consulted
 * only the projection would call an address free while a legacy user held it.
 * Neither read can decide two concurrent claims, though, so the third is the
 * address LOCK: claimed atomically before any fact is stated, which is what
 * keeps a losing verification out of the log and its proof unburned.
 */
export class IdentityGuards {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly users: IdentityUsersRepository,
    private readonly reservations: IdentityReservationRepository,
  ) {}

  /**
   * Take the address lock, or refuse (ADR-116 §6).
   *
   * The two reads above it name the ordinary case — somebody was already
   * sitting there — and this decides the race, which no read can. It runs
   * BEFORE any fact is stated, so a loser's verification never reaches the
   * log and the ceremony's single-use proof is still unburned when the
   * refusal surfaces.
   *
   * A claim already held by this user, or by this same command, is this
   * caller's own: every ceremony's staged re-run arrives here a second time
   * with the same command id, and that must cost nothing.
   */
  private async holdsAddressLock({
    userId,
    identifierId,
    commandId,
    normalizedValue,
  }: {
    userId: string;
    identifierId: string;
    commandId: string;
    normalizedValue: string;
  }): Promise<boolean> {
    const holder = await this.reservations.claim({
      normalizedValue,
      userId,
      identifierId,
      commandId,
    });
    return holder.userId === userId || holder.commandId === commandId;
  }

  private async claimOrRefuse({
    userId,
    identifierId,
    commandId,
    normalizedValue,
    verb,
  }: {
    userId: string;
    identifierId: string;
    commandId: string;
    normalizedValue: string | null;
    verb: string;
  }): Promise<void> {
    if (normalizedValue === null) return;
    const held = await this.holdsAddressLock({
      userId,
      identifierId,
      commandId,
      normalizedValue,
    });
    if (held) return;
    throw new IdentityEmailInUseError(
      `${verb}: another user holds the lock on this address`,
    );
  }

  /**
   * The cross-population uniqueness check (ADR-116 §6), asked at the two
   * moments a value becomes a CLAIM on a mailbox: verify, and primary.
   *
   * Two reads because there are two populations and one address space. The
   * projection answers for latched users; `User.email` answers for everyone
   * else. Attach never asks — an `ATTACHED` identifier blocks nobody, which
   * is what stops the guard from becoming a squatting mechanism.
   *
   * The identity half stays a DEAD-END rather than a refusal, and that is
   * deliberate: it resolves a concurrent race between two users who both
   * reached verify, where there is no caller to hand a refusal to on the
   * losing side (D01, `uniqueness_race_lost`). The legacy half is a genuine
   * refusal, because the holder was already sitting there before this
   * ceremony began and the customer can act on being told so.
   */
  private async refuseIfLegacyHolderExists({
    userId,
    normalizedValue,
    verb,
  }: {
    userId: string;
    normalizedValue: string | null;
    verb: string;
  }): Promise<void> {
    if (normalizedValue === null) return;
    const holder = await this.users.findUserIdByEmail({ normalizedValue });
    if (holder === null || holder === userId) return;
    throw new IdentityEmailInUseError(
      `${verb}: a user outside the identity population already holds this address as their User.email`,
    );
  }

  async attachIdentifier(
    data: AttachIdentifierCommandData,
  ): Promise<IdentityFactInput[]> {
    const {
      userId,
      accountId,
      provider,
      providerId,
      issuer,
      providerAccountId,
      value,
      occurredAtMs,
      commandId,
      actor,
    } = data;
    const normalizedValue = normalizeIdentifierValue(value);
    const identifierId = deriveIdentifierId({
      userId,
      provider,
      providerAccountId,
      normalizedValue,
      occurredAtMs,
    });
    // A fact the heads already carry is not stated again: the staged re-run
    // of a ceremony and every backfill pass after the first both arrive here
    // with the identifier already folded, and must cost no event_log row.
    //
    // "Carry" means FOLDED. A newborn's heads may hold a provisional row the
    // ledger wrote before staging, so the front door can route the address
    // before the fold lands; the cursor says whether the projection has ever
    // folded, and until it has, a head is an anticipation of the fact, not
    // the fact. Deduping against it would leave the log without the event,
    // the cursor unmoved and the address lock held forever.
    const heads = await this.heads.findHeads({ userId });
    if (
      heads.identifiers[identifierId] &&
      (await this.heads.hasFolded({ userId }))
    ) {
      return [];
    }
    const userHashKey = await this.heads.findUserHashKey({ userId });
    // Non-email providers arrive VERIFIED with no verify ceremony to
    // re-check them, so the attach itself is where a cross-user race
    // resolves — and the address lock is what resolves it, atomically. The
    // loser arrives ATTACHED and dead-ends in the same emission, which is
    // D01's answer for a side with no caller to refuse: an IdP callback that
    // failed would tell the customer nothing they could act on.
    //
    // An `email` attach takes no lock. It arrives ATTACHED, blocks nobody,
    // and locking there is exactly the squatting mechanism the state machine
    // exists to prevent.
    const arrivalState = arrivalStateForProvider(provider);
    const isRaceLoser =
      arrivalState === "VERIFIED" &&
      !(await this.holdsAddressLock({
        userId,
        identifierId,
        commandId,
        normalizedValue,
      }));
    const attached = (state: IdentifierArrivalState): IdentityFactInput => ({
      type: IDENTIFIER_ATTACHED_EVENT_TYPE,
      data: {
        identifierId,
        userId,
        accountId,
        provider,
        providerId,
        issuer,
        providerAccountId,
        value: normalizedValue,
        identifierHash:
          userHashKey === null
            ? null
            : computeIdentifierHash({ userHashKey, normalizedValue }),
        domain: identifierDomain(normalizedValue),
        connectionId: null,
        state,
        actor,
      },
    });
    if (isRaceLoser) {
      return [
        attached("ATTACHED"),
        {
          type: IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
          data: { identifierId, reason: "uniqueness_race_lost", actor },
        },
      ];
    }
    return [attached(arrivalState)];
  }

  async verifyIdentifier(
    data: VerifyIdentifierCommandData,
  ): Promise<IdentityFactInput[]> {
    const { userId, identifierId, verificationId, method, commandId, actor } =
      data;
    const heads = await this.heads.findHeads({ userId });
    const head = heads.identifiers[identifierId];
    if (!head) {
      throw new IdentityIdentifierNotFoundError(
        `verify_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }
    // Already verified (or primary): nothing to record.
    if (head.state === "VERIFIED" || head.state === "PRIMARY") return [];
    if (head.state !== "ATTACHED") {
      throw new IdentityIdentifierNotVerifiableError(
        `verify_identifier: identifier is ${head.state}, only ATTACHED verifies`,
      );
    }
    // The legacy population first, and BEFORE any fact is stated — which is
    // also before the ceremony consumes its verification proof, since the
    // ceremony dispatches the command and only then consumes. A refusal
    // therefore never burns the token (ADR-116 §6).
    await this.refuseIfLegacyHolderExists({
      userId,
      normalizedValue: head.value,
      verb: "verify_identifier",
    });
    // The identity population, read the same way — a named refusal for the
    // ordinary case, where the other holder was already sitting there.
    const holder =
      head.value === null
        ? null
        : await this.heads.findActiveIdentifierByValue({
            normalizedValue: head.value,
          });
    if (holder && holder.userId !== userId) {
      throw new IdentityEmailInUseError(
        "verify_identifier: another user already holds this address as a proven identifier",
      );
    }
    // And the lock, which is what actually decides a race: both reads above
    // can pass concurrently, and only one user may hold a proven address.
    // Before any fact, so the loser's verification is never recorded.
    await this.claimOrRefuse({
      userId,
      identifierId,
      commandId,
      normalizedValue: head.value,
      verb: "verify_identifier",
    });
    return [
      {
        type: IDENTIFIER_VERIFIED_EVENT_TYPE,
        data: { identifierId, verificationId, method, actor },
      },
    ];
  }

  async markPrimary(data: MarkPrimaryCommandData): Promise<IdentityFactInput[]> {
    const { userId, identifierId, actor } = data;
    const heads = await this.heads.findHeads({ userId });
    const head = heads.identifiers[identifierId];
    if (!head) {
      throw new IdentityIdentifierNotFoundError(
        `mark_primary: identifier ${identifierId} does not exist for this user`,
      );
    }
    if (head.state === "PRIMARY") return [];
    if (head.state !== "VERIFIED") {
      throw new IdentityPrimaryRequiresVerifiedError(
        `mark_primary: identifier is ${head.state}, only VERIFIED takes PRIMARY`,
      );
    }
    // PRIMARY is what the fold writes into `User.email`, so this is the
    // moment the value has to be free in the legacy population too. Refusing
    // here is what turns a `User.email @unique` write failure deep inside
    // the projection into a named refusal the caller can act on (ADR-116 §6).
    await this.refuseIfLegacyHolderExists({
      userId,
      normalizedValue: head.value,
      verb: "mark_primary",
    });
    // One fact per stream that has to move (ADR-127): the promotion, and a
    // demotion naming each identifier standing PRIMARY. The fold sweeps for
    // those itself today and a per-identifier fold cannot, so the command
    // names them here, while it can still read the whole person. For the one
    // standing PRIMARY a person actually has, this states exactly what it
    // stated before.
    return primaryChangeFacts({ heads, identifierId, actor });
  }

  async detachIdentifier(
    data: DetachIdentifierCommandData,
  ): Promise<IdentityFactInput[]> {
    const { userId, identifierId, actor } = data;
    const heads = await this.heads.findHeads({ userId });
    const head = heads.identifiers[identifierId];
    if (!head) {
      throw new IdentityIdentifierNotFoundError(
        `detach_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }
    // PRIMARY never detaches directly — demote first (D01's state machine).
    if (head.state === "PRIMARY") {
      throw new IdentityPrimaryMustDemoteFirstError(
        "detach_identifier: the PRIMARY identifier must be demoted before it detaches",
      );
    }
    if (head.state === "DETACHED") return [];
    // Removing a way IN is refused when it is the last one, or the last one
    // anybody could be recovered through (D07). Scoped to identifiers that
    // are actually usable: detaching an unverified address strands nobody,
    // because nobody could have signed in with it.
    if (head.state === "VERIFIED") {
      const strands = detachStrandsUser({ heads, identifierId });
      if (strands) throw strands;
    }
    return [
      { type: IDENTIFIER_DETACHED_EVENT_TYPE, data: { identifierId, actor } },
    ];
  }

  async eraseUser(data: EraseUserCommandData): Promise<IdentityFactInput[]> {
    const { userId, actor } = data;
    const heads = await this.heads.findHeads({ userId });
    // The ids are read from the WHOLE person rather than taken from a caller.
    // Today the fold sweeps every head and the list is the writer's audit
    // record; once the fold keys per identifier (ADR-127 slice 3) the list
    // BECOMES the sweep's bound, and a list built from anything narrower than
    // the whole person would leave an address behind — ADR-110's
    // principal-filter rule in identity's terms. The event-log mutation that
    // wipes the user's PRIOR events, the protocol-row deletions, and the
    // userHashKey shred are the erasure service's side-effects — sequenced
    // around this command, not inside it.
    return userErasureFacts({ heads, userId, actor });
  }

  /**
   * A callback's link was refused and handed to a human (ADR-117 §3). There is
   * nothing for a guard to veto: a proposal states that no identifier was
   * attached, so it can never violate an invariant the heads hold. What it
   * does do is what every other verb does — normalize the value once, here,
   * so only the normalized form ever reaches a fact.
   *
   * A retried callback dedupes on the command's idempotency key, the same way
   * every other repeated command does, so this states its fact unconditionally
   * rather than reading heads it would not use.
   */
  async proposeLink(data: ProposeLinkCommandData): Promise<IdentityFactInput[]> {
    const {
      proposalId,
      userId,
      connectionId,
      provider,
      providerAccountId,
      value,
      reason,
      actor,
    } = data;
    const normalizedValue = normalizeIdentifierValue(value);
    return [
      {
        type: LINK_PROPOSED_EVENT_TYPE,
        data: {
          proposalId,
          userId,
          connectionId,
          provider,
          providerAccountId,
          value: normalizedValue,
          domain: identifierDomain(normalizedValue),
          reason,
          actor,
        },
      },
    ];
  }
}
