import {
  type PasskeyAssertionOptions,
  PasskeyAssertionRefusedError,
  type PasskeyAssertionResponse,
} from "@langwatch/auth-contract";
import {
  type AuthenticatorTransportFuture,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

import type { PasskeyRepository, StoredPasskey } from "../repositories/passkey.repository.ts";

/** How long the browser prompt stays open, as Better Auth's passkey plugin leaves it. */
const ASSERTION_TIMEOUT_MS = 60_000;
/** Authenticator data: a 32-byte rpIdHash, then the flags byte; UV is bit 2. */
const FLAGS_OFFSET = 32;
const USER_VERIFIED_FLAG = 0x04;

/** Where this deployment's passkeys are scoped, derived the way Better Auth's plugin derives it. */
export type PasskeyRelyingParty = Readonly<{ rpId: string; origins: readonly string[] }>;

/**
 * A signature by one of a person's passkeys over exactly one caller-chosen challenge, with user
 * verification required. It proves presence for that one request; it is no step-up of a session.
 */
export class PasskeyAssertionService {
  private constructor(
    private readonly passkeys: PasskeyRepository,
    private readonly relyingParty: () => PasskeyRelyingParty,
  ) {}

  static create({
    passkeys,
    relyingParty,
  }: {
    passkeys: PasskeyRepository;
    relyingParty: () => PasskeyRelyingParty;
  }): PasskeyAssertionService {
    return new PasskeyAssertionService(passkeys, relyingParty);
  }

  /** The relying party for a deployment whose sign-in lives at `sessionUrl`. */
  static relyingPartyFor({
    sessionUrl,
    publicBaseUrl,
  }: {
    sessionUrl: string | undefined;
    publicBaseUrl: string | undefined;
  }): PasskeyRelyingParty {
    const urls = [publicBaseUrl, sessionUrl].filter((url): url is string => Boolean(url));
    return {
      rpId: sessionUrl ? new URL(sessionUrl).hostname : "localhost",
      origins: [...new Set(urls.map((url) => new URL(url).origin))],
    };
  }

  async hasPasskey({ userId }: { userId: string }): Promise<boolean> {
    return (await this.passkeys.findForUser({ userId })).length > 0;
  }

  async options({
    userId,
    challenge,
  }: {
    userId: string;
    challenge: string;
  }): Promise<PasskeyAssertionOptions> {
    const held = await this.passkeys.findForUser({ userId });
    if (held.length === 0) {
      throw new PasskeyAssertionRefusedError({ reason: "unknown_credential" });
    }

    return {
      challenge,
      rpId: this.relyingParty().rpId,
      timeout: ASSERTION_TIMEOUT_MS,
      userVerification: "required",
      allowCredentials: held.map((passkey) => ({
        id: passkey.credentialId,
        type: "public-key" as const,
        ...(passkey.transports.length > 0 ? { transports: [...passkey.transports] } : {}),
      })),
    };
  }

  async verify({
    userId,
    challenge,
    response,
  }: {
    userId: string;
    challenge: string;
    response: PasskeyAssertionResponse;
  }): Promise<{ credentialId: string }> {
    const passkey = await this.heldPasskey({ userId, credentialId: response.id });

    if (!PasskeyAssertionService.userVerified(response.response.authenticatorData)) {
      throw new PasskeyAssertionRefusedError({ reason: "user_verification_missing" });
    }

    const relyingParty = this.relyingParty();
    let newCounter: number;
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: [...relyingParty.origins],
        expectedRPID: relyingParty.rpId,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")),
          counter: passkey.counter,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
      if (!verification.verified) throw new Error("the signature did not verify");
      newCounter = verification.authenticationInfo.newCounter;
    } catch (error) {
      throw new PasskeyAssertionRefusedError({
        reason: "bad_signature",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    await this.passkeys.advanceCounter({ id: passkey.id, counter: newCounter });
    return { credentialId: passkey.credentialId };
  }

  private async heldPasskey({
    userId,
    credentialId,
  }: {
    userId: string;
    credentialId: string;
  }): Promise<StoredPasskey> {
    const rows = await this.passkeys.findByCredentialId({ credentialId });
    if (rows.length === 0) {
      throw new PasskeyAssertionRefusedError({ reason: "unknown_credential" });
    }
    const own = rows.find((row) => row.userId === userId);
    if (!own) throw new PasskeyAssertionRefusedError({ reason: "wrong_user" });
    return own;
  }

  private static userVerified(authenticatorData: string): boolean {
    const bytes = Buffer.from(authenticatorData, "base64url");
    const flags = bytes[FLAGS_OFFSET];
    return flags !== undefined && (flags & USER_VERIFIED_FLAG) !== 0;
  }
}
