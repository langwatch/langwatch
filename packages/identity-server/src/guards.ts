import {
  type AttachIdentifierCommandData,
  arrivalStateForProvider,
  type DetachIdentifierCommandData,
  type EraseUserCommandData,
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
 */
export class IdentityGuards {
  constructor(private readonly heads: IdentityHeadsRepository) {}

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
