/**
 * The passkey ceremonies, and linking an additional sign-in method.
 *
 * THE SECOND WIRE IN THIS MIGRATION, and it is here for the reason the first
 * one is: a screen may not import `better-auth` or name `fetch`, and both of
 * those are what a passkey ceremony IS. So the split is the credentials
 * family's — what the screen SAYS about an outcome is decided in
 * `@langwatch/user-web` and pinned there, and what an outcome MEANS is decided
 * here and pinned in `apps/ui/tests/ui-passkeys.unit.test.ts`.
 *
 * A SECOND AUTH CLIENT, DELIBERATELY. `ui-session-client.ts` builds one with no
 * plugins, and says why: none of the application's plugins take part in a
 * session read. The passkey plugin does take part in these four calls, and
 * declaring it there would put a WebAuthn plugin on the path of every session
 * read in the application. Two clients over the same origin and the same cookie
 * cost one object.
 *
 * THE PLUGIN IS DECLARED UNCONDITIONALLY and the DEPLOYMENT decides whether
 * anybody is offered a passkey — `PASSKEYS_ENABLED` gates the server half and
 * the screen's own section. Gating the client half too would be a second place
 * for the two to disagree, and the failure would be a button that exists
 * calling an endpoint that does not.
 */

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/** One passkey, as the plugin stores it and the screen reads it. */
export type UiPasskey = {
  id: string;
  name?: string | null;
  createdAt: string | Date;
  transports?: string | null;
};

/**
 * How a ceremony ended.
 *
 * `cancelled` is the whole reason this is not a boolean. better-auth reports a
 * device prompt the person dismissed as an error with STATUS ZERO — there was
 * no response, because there was no request — and a zero is the only thing that
 * tells a dismissal apart from a refusal. Reading it as a failure means telling
 * somebody off for a decision they made.
 */
export type UiPasskeyOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false };

/** As much of the passkey client as these four calls use. */
type UiPasskeyClient = {
  passkey: {
    listUserPasskeys: () => Promise<{ data?: unknown; error?: { status?: number } | null }>;
    addPasskey: (
      input: Record<string, never>,
    ) => Promise<{ data?: unknown; error?: { status?: number } | null } | undefined>;
    deletePasskey: (input: {
      id: string;
    }) => Promise<{ data?: unknown; error?: { status?: number } | null } | undefined>;
    updatePasskey: (input: {
      id: string;
      name: string;
    }) => Promise<{ data?: unknown; error?: { status?: number } | null } | undefined>;
  };
};

let sharedClient: UiPasskeyClient | undefined;

/**
 * The one passkey client per document.
 *
 * Built on first use rather than at module scope, the same way the session
 * client is: constructing it resolves the base URL from `window.location`, and
 * a package entry point that does that on import cannot be loaded anywhere
 * else.
 */
function passkeyAuthClient(): UiPasskeyClient {
  sharedClient ??= createAuthClient({
    plugins: [passkeyClient()],
  }) as unknown as UiPasskeyClient;
  return sharedClient;
}

/**
 * A result object, or a thrown error, turned into the one answer above.
 *
 * A THROW IS NEVER A CANCELLATION. The device could not run the ceremony at
 * all — no authenticator, an insecure context, a browser that does not
 * implement WebAuthn — and none of those is a decision the person made.
 */
export function readPasskeyOutcome(
  result:
    | {
        error?: { status?: number } | null;
      }
    | undefined,
): UiPasskeyOutcome {
  const error = result?.error;
  if (!error) return { ok: true };
  return { ok: false, cancelled: error.status === 0 };
}

/** Every passkey this account holds. */
export async function listUiPasskeys(
  client: UiPasskeyClient = passkeyAuthClient(),
): Promise<UiPasskey[]> {
  const result = await client.passkey.listUserPasskeys();
  return Array.isArray(result?.data) ? (result.data as UiPasskey[]) : [];
}

/** Runs the registration ceremony on this device. */
export async function registerUiPasskey(
  client: UiPasskeyClient = passkeyAuthClient(),
): Promise<UiPasskeyOutcome> {
  try {
    return readPasskeyOutcome(await client.passkey.addPasskey({}));
  } catch {
    return { ok: false, cancelled: false };
  }
}

/** Removes one passkey from the account. The device keeps its own copy. */
export async function removeUiPasskey(
  { id }: { id: string },
  client: UiPasskeyClient = passkeyAuthClient(),
): Promise<UiPasskeyOutcome> {
  try {
    return readPasskeyOutcome(await client.passkey.deletePasskey({ id }));
  } catch {
    return { ok: false, cancelled: false };
  }
}

/** Gives one passkey a name somebody will recognise later. */
export async function renameUiPasskey(
  { id, name }: { id: string; name: string },
  client: UiPasskeyClient = passkeyAuthClient(),
): Promise<UiPasskeyOutcome> {
  try {
    return readPasskeyOutcome(await client.passkey.updatePasskey({ id, name }));
  } catch {
    return { ok: false, cancelled: false };
  }
}

/** How an attempt to link an additional sign-in method ended. */
export type UiLinkSignInMethodOutcome = { ok: true } | { ok: false; reason?: string };

/**
 * better-auth's internal id for a provider the product names differently.
 *
 * `azure-ad` is what `NEXTAUTH_PROVIDER` is set to and `microsoft` is what the
 * social plugin registers, and the mapping has to happen on this side of the
 * seam: a screen that knew about it would be encoding a library's naming.
 */
function providerId(provider: string): string {
  return provider === "azure-ad" ? "microsoft" : provider;
}

/**
 * Links an additional sign-in method to the account already signed in.
 *
 * `/link-social` RATHER THAN A SIGN-IN, which is the whole point of the
 * endpoint: better-auth enforces same-email matching on it, so linking cannot
 * become the "sign in while already signed in and silently switch accounts"
 * regression that calling `signIn(provider)` here would be. ONE endpoint since
 * better-auth 1.7 — generic-OAuth providers used to link through the plugin's
 * own route, and an Okta account now links exactly the way a GitHub one does.
 *
 * The provider answers with a URL to send the reader to, and the navigation is
 * a FULL PAGE one: the destination is the identity provider's own origin, which
 * the application's router cannot address.
 */
export async function linkUiSignInMethod(
  provider: string,
  { callbackUrl }: { callbackUrl: string },
): Promise<UiLinkSignInMethodOutcome> {
  const response = await fetch("/api/auth/link-social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider: providerId(provider), callbackURL: callbackUrl }),
  });
  if (!response.ok) {
    return { ok: false, reason: await response.text() };
  }
  const body = (await response.json()) as { url?: string; redirect?: boolean };
  if (body.url && body.redirect !== false) {
    window.location.href = body.url;
  }
  return { ok: true };
}
