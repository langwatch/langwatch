/**
 * A CDP virtual WebAuthn authenticator, for driving real passkey ceremonies
 * without a physical device or an OS-level platform authenticator.
 *
 * No such helper existed anywhere under `tests/agentic-e2e` before this file —
 * every passkey-touching scenario in the four identity specs this pass binds
 * against was `@unimplemented`, `@unit`, or exercised only through mocks. This
 * is Playwright's own supported mechanism (the Chrome DevTools Protocol's
 * `WebAuthn` domain): it registers a software authenticator that answers
 * `navigator.credentials.create()` / `.get()` calls exactly as a real one
 * would, over the real `@simplewebauthn` verification path on the server —
 * nothing about the ceremony itself is stubbed.
 */
import type { CDPSession, Page } from "@playwright/test";

export interface VirtualAuthenticator {
  authenticatorId: string;
  session: CDPSession;
}

/**
 * Attaches a resident-key, user-verifying platform authenticator to `page`
 * and enables the WebAuthn domain on its CDP session.
 *
 * `hasResidentKey: true` is required for a discoverable-credential request —
 * signing in with a passkey with no email typed, or a settings page
 * `addPasskey()` call with no `allowCredentials` list — to find anything at
 * all. `isUserVerified: true` answers the authenticator's own user-presence
 * and user-verification prompts automatically, which is what lets a ceremony
 * that would otherwise wait on a fingerprint or a PIN complete headlessly.
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
