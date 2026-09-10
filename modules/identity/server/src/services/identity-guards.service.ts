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
} from "@langwatch/identity-contract";
import type { IdentifierIdentity } from "../app/identity.members.ts";
import { computeIdentifierHash } from "../rules/identifier-hash.rules.ts";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import type { IdentityReservationRepository } from "../repositories/identity-reservations.repository.ts";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository.ts";

/**
 * The identity guards (ADR-101 §2): what runs BEFORE any fact exists — the
 * (ADR-116 §6). The heads answer for latched users; `User.email` answers for
 */
export class IdentityGuardsService {
  static create(
    heads: IdentityHeadsRepository,
    users: IdentityUsersRepository,
    reservations: IdentityReservationRepository,
    identifiers: IdentifierIdentity,
  ): IdentityGuardsService {
    return new IdentityGuardsService(heads, users, reservations, identifiers);
  }

  private constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly users: IdentityUsersRepository,
    private readonly reservations: IdentityReservationRepository,
    private readonly identifiers: IdentifierIdentity,
  ) {}

  /**
   * Take the address lock, or refuse (ADR-116 §6).
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
    if (normalizedValue === null) {
      return;
    }

    const held = await this.holdsAddressLock({
      userId,
      identifierId,
      commandId,
      normalizedValue,
    });
    if (held) {
      return;
    }

    throw new IdentityEmailInUseError(`${verb}: another user holds the lock on this address`);
  }

  /**
   * The cross-population uniqueness check (ADR-116 §6), asked at the two
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
    if (normalizedValue === null) {
      return;
    }

    const holder = await this.users.tryFindUserIdByEmail({ normalizedValue });
    if (holder === null || holder === userId) {
      return;
    }

    throw new IdentityEmailInUseError(
      `${verb}: a user outside the identity population already holds this address as their User.email`,
    );
  }

  async attachIdentifier(data: AttachIdentifierCommandData): Promise<IdentityFactInput[]> {
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
    const identifierId = this.identifiers.deriveIdentifierId({
      userId,
      provider,
      providerAccountId,
      normalizedValue,
      occurredAtMs,
    });
    // A fact the heads already carry is not stated again: the staged re-run
    // of a ceremony and every backfill pass after the first both arrive here
    // with the identifier already folded, and must cost no event_log row.
    const heads = await this.heads.findHeads({ userId });
    if (heads.identifiers[identifierId]) {
      return [];
    }

    const userHashKey = await this.heads.tryFindUserHashKey({ userId });
    // Non-email providers arrive VERIFIED with no verify ceremony to re-check them, so the
    // attach itself is where a cross-user race resolves — and the address lock is what resolves
    // it, atomically. The loser arrives ATTACHED and dead-ends in the same emission, which is
    // D01's answer for a side with no caller to refuse: an IdP callback that failed would tell
    // the customer nothing they could act on. An `email` attach takes no lock.
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
          userHashKey === null ? null : computeIdentifierHash({ userHashKey, normalizedValue }),
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

  async verifyIdentifier(data: VerifyIdentifierCommandData): Promise<IdentityFactInput[]> {
    const { userId, identifierId, verificationId, method, commandId, actor } = data;
    const heads = await this.heads.findHeads({ userId });
    const head = heads.identifiers[identifierId];
    if (!head) {
      throw new IdentityIdentifierNotFoundError(
        `verify_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }

    // Already verified (or primary): nothing to record.
    if (head.state === "VERIFIED" || head.state === "PRIMARY") {
      return [];
    }

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
        : await this.heads.tryFindActiveIdentifierByValue({
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

    if (head.state === "PRIMARY") {
      return [];
    }

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
    return primaryChangeFacts({ heads, identifierId, actor });
  }

  async detachIdentifier(data: DetachIdentifierCommandData): Promise<IdentityFactInput[]> {
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

    if (head.state === "DETACHED") {
      return [];
    }

    // Removing a way IN is refused when it is the last one, or the last one
    // anybody could be recovered through (D07). Scoped to identifiers that
    // are actually usable: detaching an unverified address strands nobody,
    // because nobody could have signed in with it.
    if (head.state === "VERIFIED") {
      const remaining = Object.values(heads.identifiers).filter(
        (candidate) =>
          candidate.identifierId !== identifierId &&
          (candidate.state === "VERIFIED" || candidate.state === "PRIMARY"),
      );
      if (remaining.length === 0) {
        throw new IdentityDetachStrandsUserError(
          `detach_identifier: ${identifierId} is the last verified identifier for this user`,
        );
      }

      // A passkey is a way in and not a way back: it has no address, so a
      // person holding only passkeys has nowhere a recovery message could
      // reach them. The remedy the screen offers is a verified email.
      if (remaining.every((candidate) => candidate.provider === "passkey")) {
        throw new IdentityDetachStrandsUserError(
          `detach_identifier: removing ${identifierId} would leave this user with passkeys only and no recovery address`,
        );
      }
    }

    return [{ type: IDENTIFIER_DETACHED_EVENT_TYPE, data: { identifierId, actor } }];
  }

  async eraseUser(data: EraseUserCommandData): Promise<IdentityFactInput[]> {
    const { userId, actor } = data;
    const heads = await this.heads.findHeads({ userId });

    // The ids are read from the WHOLE person rather than taken from a caller. Today the fold
    // sweeps every head and the list is the writer's audit
    // record; once the fold keys per identifier (ADR-127 slice 3) the list
    // the whole person would leave an address behind — ADR-110's
    return userErasureFacts({ heads, userId, actor });
  }

  /**
   * A callback's link was refused and handed to a human (ADR-117 §3). There is
   */
  async proposeLink(data: ProposeLinkCommandData): Promise<IdentityFactInput[]> {
    const { proposalId, userId, connectionId, provider, providerAccountId, value, reason, actor } =
      data;
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
