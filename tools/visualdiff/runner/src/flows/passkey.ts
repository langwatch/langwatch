import type { CDPSession, Page } from "playwright";

import type { Action } from "./context.ts";

/** OPEN keeps each page's CDP session alive: a detached session takes its authenticator with it. */
const OPEN = new WeakMap<Page, CDPSession>();

/**
 * passkey opens a WebAuthn virtual authenticator on the step's page (CTAP2, internal, resident
 * keys, user verification passing), so passkey add, sign-in, rename and delete run headless.
 * A second step on the same page keeps the one authenticator, and the credentials it holds.
 */
export const passkey: Action = async (context) => {
  const { page } = context.side;
  if (OPEN.has(page)) return;
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  OPEN.set(page, session);
};
