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

/** The kinds `haven browser authenticator add --kind` offers, with the same defaults. */
const KINDS = {
  passkey: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
  },
  "security-key": {
    protocol: "ctap2",
    transport: "usb",
    hasResidentKey: false,
    hasUserVerification: false,
  },
  u2f: { protocol: "u2f", transport: "usb", hasResidentKey: false, hasUserVerification: false },
} as const;

/**
 * Attaches a virtual authenticator; the default passkey is resident and user-verifying, so a
 * discoverable request finds anything and the fingerprint/PIN prompt answers itself.
 * Fail user verification with `session.send("WebAuthn.setUserVerified", ...)`.
 */
export async function addVirtualAuthenticator(
  page: Page,
  { kind = "passkey" }: { kind?: keyof typeof KINDS } = {},
): Promise<VirtualAuthenticator> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  const options = KINDS[kind];
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      ...options,
      isUserVerified: options.hasUserVerification,
      automaticPresenceSimulation: true,
    },
  });
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
