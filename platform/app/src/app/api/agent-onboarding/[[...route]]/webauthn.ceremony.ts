import type {
  PasskeyCredential,
  WebAuthnCeremony,
} from "@langwatch/ai-onboarding";
import { createLogger } from "@langwatch/observability";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const logger = createLogger("langwatch:agent-onboarding:webauthn");

/**
 * The `@simplewebauthn/server` half of the enrollment ceremony.
 *
 * Lives in the app, not in `@langwatch/ai-onboarding`, so the package keeps no
 * crypto dependency and its enrollment logic stays unit-testable against a
 * fake. It is also where the RP identity is decided, which is deployment
 * configuration rather than domain knowledge.
 */
export class SimpleWebAuthnCeremony implements WebAuthnCeremony {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(params: { appBaseUrl: string; rpName: string }) {
    const url = new URL(params.appBaseUrl);
    // The RP ID is the bare hostname — no scheme, no port. Getting this wrong
    // is silent until a real authenticator refuses the ceremony, because the
    // browser compares it against the page's own origin.
    this.rpID = url.hostname;
    this.origin = url.origin;
    this.rpName = params.rpName;
  }

  private readonly rpName: string;

  async buildRegistrationOptions(params: {
    userId: string;
    userName: string;
    userDisplayName: string;
  }): Promise<{ options: Record<string, unknown>; challenge: string }> {
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: new TextEncoder().encode(params.userId),
      userName: params.userName,
      userDisplayName: params.userDisplayName,
      attestationType: "none",
      authenticatorSelection: {
        // The phone's own biometric. `residentKey: required` is what makes it
        // a *passkey* — discoverable, so signing in later needs no username.
        residentKey: "required",
        userVerification: "preferred",
      },
    });

    return {
      options: options as unknown as Record<string, unknown>,
      challenge: options.challenge,
    };
  }

  async verifyRegistration(params: {
    response: Record<string, unknown>;
    expectedChallenge: string;
  }): Promise<PasskeyCredential | null> {
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        // The library owns this wire shape; the contract passes it through
        // rather than restating a spec we do not control.
        response: params.response as never,
        expectedChallenge: params.expectedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
    } catch (error) {
      // A malformed or replayed attestation throws rather than returning
      // `verified: false`. Both mean the same thing to the caller, so it is
      // flattened here instead of leaking the library's exception shape.
      logger.warn({ error }, "passkey attestation did not verify");
      return null;
    }

    if (!verification.verified || !verification.registrationInfo) return null;

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    return {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? null,
    };
  }
}
