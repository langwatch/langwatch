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
  IdentityIdentifierNotFoundError,
  IdentityIdentifierNotVerifiableError,
  IdentityPrimaryMustDemoteFirstError,
  IdentityPrimaryRequiresVerifiedError,
  type IdentityFactInput,
  identifierDomain,
  type MarkPrimaryCommandData,
  normalizeIdentifierValue,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
  type VerifyIdentifierCommandData,
} from "@langwatch/identity";
import {
  computeIdentifierHash,
  deriveIdentifierId,
} from "./crypto/identifier-identity";
import type { IdentityHeadsRepository } from "./identity-heads.repository";
import type { IdentityUsersRepository } from "./identity-users.repository";

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
 * Two repositories, because uniqueness spans two populations (ADR-116 §6).
 * The heads answer for latched users; `User.email` answers for everyone the
 * identity branch has not adopted yet. A guard that consulted only the
 * projection would call an address free while a legacy user held it, and the
 * collision would surface as a unique-constraint failure inside the fold
 * rather than a refusal the caller can act on.
 */
export class IdentityGuards {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly users: IdentityUsersRepository,
  ) {}

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
      providerAccountId,
      value,
      occurredAtMs,
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
    const heads = await this.heads.findHeads({ userId });
    if (heads.identifiers[identifierId]) return [];
    const userHashKey = await this.heads.findUserHashKey({ userId });
    // Uniqueness of VERIFIED values is a command-time guard (D01). Non-email
    // providers arrive VERIFIED with no verify ceremony to re-check them, so
    // the attach itself is where a cross-user race resolves: the loser
    // arrives ATTACHED and dead-ends in the same emission, mirroring the
    // verify path's `uniqueness_race_lost`.
    const arrivalState = arrivalStateForProvider(provider);
    const holder =
      arrivalState !== "VERIFIED"
        ? null
        : await this.heads.findActiveIdentifierByValue({ normalizedValue });
    const isRaceLoser = holder !== null && holder.userId !== userId;
    const attached = (state: IdentifierArrivalState): IdentityFactInput => ({
      type: IDENTIFIER_ATTACHED_EVENT_TYPE,
      data: {
        identifierId,
        userId,
        accountId,
        provider,
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
    const { userId, identifierId, verificationId, method, actor } = data;
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
    // Uniqueness of VERIFIED values is re-checked here — concurrent verifies
    // of the same value are serialized by the per-user queue only within one
    // user, so the loser of a cross-user race dead-ends rather than verifying
    // (D01). No DB unique constraint backs this up: tombstones and replay
    // make constraints lie.
    const holder =
      head.value === null
        ? null
        : await this.heads.findActiveIdentifierByValue({
            normalizedValue: head.value,
          });
    if (holder && holder.userId !== userId) {
      return [
        {
          type: IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
          data: { identifierId, reason: "uniqueness_race_lost", actor },
        },
      ];
    }
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
    const previous = Object.values(heads.identifiers).find(
      (candidate) => candidate.state === "PRIMARY",
    );
    return [
      {
        type: PRIMARY_CHANGED_EVENT_TYPE,
        data: {
          identifierId,
          previousIdentifierId: previous?.identifierId ?? null,
          actor,
        },
      },
    ];
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
    return [
      { type: IDENTIFIER_DETACHED_EVENT_TYPE, data: { identifierId, actor } },
    ];
  }

  async eraseUser(data: EraseUserCommandData): Promise<IdentityFactInput[]> {
    const { userId, actor } = data;
    const heads = await this.heads.findHeads({ userId });
    // The fact is the record that erasure happened; the ids are the writer's
    // audit list, not the sweep's bound (the fold wipes every head). The
    // event-log mutation that wipes the user's PRIOR events, the protocol-row
    // deletions, and the userHashKey shred are the erasure service's
    // side-effects — sequenced around this command, not inside it.
    return [
      {
        type: USER_ERASED_EVENT_TYPE,
        data: {
          userId,
          erasedIdentifierIds: Object.keys(heads.identifiers),
          actor,
        },
      },
    ];
  }
}
