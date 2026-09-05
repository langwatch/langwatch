import {
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  type IdentityFact,
  IdentityEmailInUseError,
  IdentityVerificationExpiredError,
  IdentityVerificationInvalidError,
} from "@langwatch/identity-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { mintVerificationToken, s256Challenge, safeEqual, sha256Hex } from "../rules/pkce.rules";
import { newIdentityCommandId } from "../rules/identity-command-id.rules";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository";
import type { IdentityVerificationRepository } from "../repositories/identity-verification.repository";
import type { IdentityVerificationWrites } from "../rules/identity-writes.rules";

const logger = createLogger("langwatch:identity:verification-ceremony");

export const IDENTITY_VERIFICATION_TTL_MS = 15 * 60 * 1000;

/** The emission that means the address went to somebody else mid-ceremony. */
function lostTheUniquenessRace(facts: readonly IdentityFact[]): boolean {
  return facts.some(
    (fact) =>
      fact.type === IDENTIFIER_DEAD_ENDED_EVENT_TYPE && fact.data.reason === "uniqueness_race_lost",
  );
}

export interface MintedEmailVerification {
  verificationId: string;
  /** The raw single-use token — rides only in the magic link, never at rest. */
  token: string;
  expiresAtMs: number;
}

export interface VerificationCeremonyDeps {
  /** The per-user write gate. Completion emits a verify command, and
   *  ADR-101 §2 holds that no user's live events precede their history —
   *  so an unlatched user's completion is refused here, the same way the
   *  adapter's domain writes are withheld. Injected, never defaulted: the
   *  gate is the app's, and the wiring is visible in one place. */
  isLatched: (args: { userId: string }) => Promise<boolean>;
  now?: () => number;
}

/**
 * The email verification ceremony (D01 — magic link + proof binding). Two distinct proofs,
 * checked at completion and never separable: 1. Mailbox control — the single-use token from the
 * emailed link, HASHED at rest with a 15-minute TTL. 2.
 */
export class VerificationCeremonyService {
  private readonly now: () => number;

  static create(
    store: IdentityVerificationRepository,
    heads: IdentityHeadsRepository,
    identity: IdentityVerificationWrites,
    deps: VerificationCeremonyDeps,
  ): VerificationCeremonyService {
    return new VerificationCeremonyService(store, heads, identity, deps);
  }

  private constructor(
    private readonly store: IdentityVerificationRepository,
    private readonly heads: IdentityHeadsRepository,
    private readonly identity: IdentityVerificationWrites,
    private readonly deps: VerificationCeremonyDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Start the ceremony: pin a fresh single-use record to exactly this
   * (identifier, user) and this context's PKCE challenge. The caller mails
   * the returned raw token; this service never sends email.
   */
  async mintEmailVerification(args: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<MintedEmailVerification> {
    const { userId, identifierId, codeChallenge } = args;
    const head = await this.heads.tryFindIdentifier({ userId, identifierId });
    if (head?.provider !== "email" || head.state !== "ATTACHED") {
      logger.warn(
        { userId, identifierId, state: head?.state ?? "missing" },
        "verification mint refused: not an ATTACHED email identifier of this user",
      );

      throw new IdentityVerificationInvalidError();
    }

    const verificationId = generate("verif").toString();
    const token = mintVerificationToken();
    const expiresAtMs = this.now() + IDENTITY_VERIFICATION_TTL_MS;
    await this.store.replaceForIdentifier({
      verificationId,
      userId,
      identifierId,
      tokenHash: sha256Hex(token),
      codeChallenge,
      expiresAtMs,
    });

    return { verificationId, token, expiresAtMs };
  }

  /**
   * Complete the ceremony — the POST half of GET-renders/POST-completes.
   */
  async completeEmailVerification(args: {
    userId: string;
    identifierId: string;
    verificationId: string;
    token: string;
    codeVerifier: string;
  }): Promise<void> {
    const { userId, identifierId, verificationId, token, codeVerifier } = args;
    // Annotated explicitly: control-flow narrowing after a `never` call only
    // applies when the callee's declared type says so.
    const refuse: (reason: string) => never = (reason) => {
      logger.warn(
        { userId, identifierId, verificationId, reason },
        "verification completion refused",
      );

      throw new IdentityVerificationInvalidError();
    };

    if (!(await this.deps.isLatched({ userId }))) {
      refuse("user's identifier backfill is not finalized; no live events yet");
    }

    const record = await this.store.tryFindByIdentifierId({ identifierId });
    if (!record) {
      refuse("no ceremony in flight for this identifier");
    }

    if (
      record.verificationId !== verificationId ||
      record.identifierId !== identifierId ||
      record.userId !== userId
    ) {
      // The identity pin (D01): the record targets exactly one
      // (verificationId, identifierId, userId) triple, checked whole.
      refuse("record pin mismatch");
    }

    if (this.now() > record.expiresAtMs) {
      logger.warn(
        { userId, identifierId, verificationId },
        "verification completion refused: expired",
      );

      throw new IdentityVerificationExpiredError();
    }

    if (!safeEqual(sha256Hex(token), record.tokenHash)) {
      refuse("token hash mismatch");
    }

    if (!safeEqual(s256Challenge(codeVerifier), record.codeChallenge)) {
      refuse("PKCE verifier does not match the bound challenge");
    }

    // Dispatch BEFORE consuming: if persistence rejects, the record survives
    // and the same valid link retries. The command is idempotent, so a
    // concurrent identical completion cannot double-verify.
    const facts = await this.identity.verifyIdentifier({
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      identifierId,
      verificationId,
      method: "magic-link",
      occurredAtMs: this.now(),
      actor: { type: "user", id: userId },
    });

    if (lostTheUniquenessRace(facts)) {
      this.deadEnd({ userId, identifierId, verificationId });
    }

    const consumed = await this.store.consume({ identifierId, verificationId });
    if (!consumed) {
      // A concurrent identical completion won the consume, or a newer mint
      // superseded mid-flight — the verification itself landed, so this is
      // success, not a refusal.
      logger.info(
        { userId, identifierId, verificationId },
        "verification record already consumed after the verify command landed",
      );
    }
  }

  /**
   * The guard resolved a cross-user race by DEAD-ENDING this identifier rather than refusing
   * (D01: on the losing side of a concurrent verify there is no caller to refuse).
   */
  private deadEnd(context: {
    userId: string;
    identifierId: string;
    verificationId: string;
  }): never {
    logger.warn(context, "verification completion dead-ended: another user holds this address");

    throw new IdentityEmailInUseError(
      "complete_email_verification: another user's verified identifier holds this address",
    );
  }
}
