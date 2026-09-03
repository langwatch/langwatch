/**
 * Passkey ceremonies live here, not in a screen, which may not import
 * `better-auth` or `fetch`. A SECOND auth client, deliberately — its
 * plugin declares unconditionally, so only `PASSKEYS_ENABLED` gates it.
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
 * `cancelled` is why this isn't a boolean: better-auth reports a dismissed
 * device prompt as STATUS ZERO, the only thing that tells a dismissal
 * apart from a refusal — reading it as failure blames a decision made.
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
 * The one passkey client per document — built on first use like the
 * session client, since constructing it resolves the base URL from
 * `window.location`.
 */
function passkeyAuthClient(): UiPasskeyClient {
  sharedClient ??= createAuthClient({
    plugins: [passkeyClient()],
  }) as unknown as UiPasskeyClient;
  return sharedClient;
}

/**
 * A THROW IS NEVER A CANCELLATION — the device couldn't run the ceremony
 * at all (no authenticator, insecure context), not a decision made.
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
 * `azure-ad` (`NEXTAUTH_PROVIDER`) maps to `microsoft` (the social
 * plugin's name) — done here so no screen encodes a library's naming.
 */
function providerId(provider: string): string {
  return provider === "azure-ad" ? "microsoft" : provider;
}

/**
 * `/link-social`, not `signIn(provider)` — better-auth enforces
 * same-email matching there, avoiding a silent account switch. Full-PAGE
 * navigation: the destination is the identity provider's own origin.
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
