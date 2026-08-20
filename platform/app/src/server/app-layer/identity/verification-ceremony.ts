/**
 * The email verification ceremony (D01 — magic link + proof binding).
 *
 * Two distinct proofs, checked at completion and never separable:
 *
 *   1. Mailbox control — the single-use token from the emailed link, HASHED
 *      at rest with a 15-minute TTL.
 *   2. Ceremony ownership (PKCE) — the initiating context mints a
 *      `code_verifier` and sends only its S256 challenge at mint time;
 *      completion requires the verifier. A forwarded link, a mail-scanner
 *      prefetch, or a token replayed from another context cannot complete
 *      the ceremony, because possession of the link alone is insufficient.
 *
 * Identity binding on top: the record pins `verificationId → (identifierId,
 * userId)` at mint, and completion verifies the consumed record targets
 * exactly the identifier being verified — a token can never verify a
 * different identifier, user, or a re-attached successor.
 *
 * The record itself is row-truth on the better-auth Verification protocol
 * table (see the repository); the events carry only `verificationId` and
 * `method` — the token and verifier never appear in any event (payload rule).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { IdentityCeremonies } from "./identity-ceremonies";
import { newIdentityCommandId } from "./identity-ceremonies";

const logger = createLogger("langwatch:identity:verification-ceremony");

export const IDENTITY_VERIFICATION_TTL_MS = 15 * 60 * 1000;

export interface IdentityVerificationRecord {
  verificationId: string;
  userId: string;
  identifierId: string;
  /** SHA-256 hex of the emailed token — the raw token is never at rest. */
  tokenHash: string;
  /** The initiating context's S256 PKCE challenge, bound at mint. */
  codeChallenge: string;
  expiresAtMs: number;
}

export interface IdentityVerificationStore {
  /** Minting replaces any prior record for the same identifier — a newer
   *  mint invalidates every older link. */
  replaceForIdentifier(record: IdentityVerificationRecord): Promise<void>;
  findByIdentifierId(params: {
    identifierId: string;
  }): Promise<IdentityVerificationRecord | null>;
  /** Deletes the record if and only if it still names this verification;
   *  false means already consumed (or superseded) — single-use enforcement. */
  consume(params: {
    identifierId: string;
    verificationId: string;
  }): Promise<boolean>;
}

/** The identifier fact the mint guard needs, as the projection knows it. */
export interface VerifiableIdentifierReads {
  findIdentifier(params: {
    userId: string;
    identifierId: string;
  }): Promise<{ provider: string; state: string } | null>;
}

/**
 * A ceremony refusal. Two customer-visible codes only, on purpose: every
 * pin/proof/consumption failure answers `identity_verification_invalid` so
 * the completion endpoint is not an oracle for which check failed — the
 * precise reason goes to the log line, keyed by verificationId. Expiry is
 * separable because its remediation differs (request a new link).
 */
export class IdentityVerificationInvalidError extends HandledError {
  constructor() {
    super("identity_verification_invalid", "identity_verification_invalid", {
      httpStatus: 400,
      fault: "customer",
      tips: [
        "Open the newest verification email and complete it from the place where you requested it.",
      ],
    });
    this.name = "IdentityVerificationInvalidError";
  }
}

export class IdentityVerificationExpiredError extends HandledError {
  constructor() {
    super("identity_verification_expired", "identity_verification_expired", {
      httpStatus: 410,
      fault: "customer",
      tips: ["Request a new verification email and use the newest link."],
    });
    this.name = "IdentityVerificationExpiredError";
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** RFC 7636 S256: base64url(SHA-256(code_verifier)). */
export function s256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return (
    bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB)
  );
}

export interface MintedEmailVerification {
  verificationId: string;
  /** The raw single-use token — rides only in the magic link, never at rest. */
  token: string;
  expiresAtMs: number;
}

export interface VerificationCeremonyDeps {
  store: IdentityVerificationStore;
  identifiers: VerifiableIdentifierReads;
  ceremonies: Pick<IdentityCeremonies, "verifyIdentifier">;
  now?: () => number;
}

export class VerificationCeremonyService {
  private readonly now: () => number;

  constructor(private readonly deps: VerificationCeremonyDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Start the ceremony: pin a fresh single-use record to exactly this
   * (identifier, user) and this context's PKCE challenge. The caller mails
   * the returned raw token; this service never sends email.
   */
  async mintEmailVerification(params: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<MintedEmailVerification> {
    const { userId, identifierId, codeChallenge } = params;
    const fact = await this.deps.identifiers.findIdentifier({
      userId,
      identifierId,
    });
    if (!fact || fact.provider !== "email" || fact.state !== "ATTACHED") {
      logger.warn(
        { userId, identifierId, state: fact?.state ?? "missing" },
        "verification mint refused: not an ATTACHED email identifier of this user",
      );
      throw new IdentityVerificationInvalidError();
    }
    const verificationId = generate("verif").toString();
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = this.now() + IDENTITY_VERIFICATION_TTL_MS;
    await this.deps.store.replaceForIdentifier({
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
   * Every check must pass against the ONE record the identifier pins;
   * consumption is transactional single-use and happens before the verify
   * command dispatches, so a replay of the same completion finds no record.
   */
  async completeEmailVerification(params: {
    userId: string;
    identifierId: string;
    verificationId: string;
    token: string;
    codeVerifier: string;
  }): Promise<void> {
    const { userId, identifierId, verificationId, token, codeVerifier } =
      params;
    const refuse = (reason: string): never => {
      logger.warn(
        { userId, identifierId, verificationId, reason },
        "verification completion refused",
      );
      throw new IdentityVerificationInvalidError();
    };

    const record = await this.deps.store.findByIdentifierId({ identifierId });
    if (!record) refuse("no ceremony in flight for this identifier");
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
    if (!safeEqualHex(sha256Hex(token), record.tokenHash)) {
      refuse("token hash mismatch");
    }
    if (!safeEqualHex(s256Challenge(codeVerifier), record.codeChallenge)) {
      refuse("PKCE verifier does not match the bound challenge");
    }
    const consumed = await this.deps.store.consume({
      identifierId,
      verificationId,
    });
    if (!consumed) refuse("record already consumed");

    await this.deps.ceremonies.verifyIdentifier({
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      identifierId,
      verificationId,
      method: "magic-link",
      occurredAtMs: this.now(),
      actor: { type: "user", id: userId },
    });
  }
}
