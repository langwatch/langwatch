/**
 * A CDP virtual WebAuthn authenticator for driving real passkey ceremonies
 * without a physical device — Playwright's own CDP `WebAuthn` domain, over
 * the real `@simplewebauthn` server path. Nothing about it is stubbed.
 */
import type { CDPSession, Page } from "@playwright/test";

export interface VirtualAuthenticator {
  authenticatorId: string;
  session: CDPSession;
}

/**
 * Attaches a resident-key, user-verifying authenticator. `hasResidentKey`
 * lets a discoverable-credential request (no email, no allowCredentials)
 * find anything; `isUserVerified` auto-answers the fingerprint/PIN prompt.
 */
export async function addVirtualAuthenticator(
  page: Page,
): Promise<VirtualAuthenticator> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { authenticatorId, session };
}

/** Detaches the authenticator. Call from a test's own cleanup. */
export async function removeVirtualAuthenticator(
  authenticator: VirtualAuthenticator,
): Promise<void> {
  await authenticator.session.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });
}
