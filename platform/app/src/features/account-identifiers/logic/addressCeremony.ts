/**
 * The browser's half of D01's address-confirmation ceremony.
 *
 * Confirming an address takes TWO proofs and they must arrive together: the
 * single-use token from the emailed link, and the PKCE verifier held by the
 * context that STARTED the ceremony. This module owns the second one.
 *
 * That is what makes a forwarded link — or a mail scanner's prefetch, or a
 * link pasted into a colleague's browser — confirm nothing: it carries the
 * token and nothing else, and the token alone is insufficient by design.
 *
 * `sessionStorage`, not `localStorage`, and keyed per identifier: the
 * verifier is worth exactly one ceremony, it should not outlive the tab that
 * asked, and two addresses added in one sitting must not overwrite each
 * other's proof.
 */

const STORAGE_PREFIX = "lw.identity.address-verifier.";

/** RFC 7636 §4.1: 43-128 characters from the unreserved set. */
const VERIFIER_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A fresh verifier and the challenge that stands in for it on the wire.
 *
 * Throws where the browser has no Web Crypto at all — an insecure origin, or
 * a context that blocked it. The caller reports it as a failure to START,
 * which is honest: nothing was sent, and nothing can be until the address bar
 * says https.
 */
export async function mintAddressCeremony(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "this browser exposes no Web Crypto, so no verification can be started here",
    );
  }
  const codeVerifier = base64url(
    globalThis.crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)),
  );
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return { codeVerifier, codeChallenge: base64url(new Uint8Array(digest)) };
}

/** Keep the verifier until the emailed link comes back to this browser. */
export function rememberAddressVerifier({
  identifierId,
  codeVerifier,
}: {
  identifierId: string;
  codeVerifier: string;
}): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${identifierId}`, codeVerifier);
  } catch {
    // A browser with storage blocked can still start the ceremony; it simply
    // cannot finish it here, and the landing state says so rather than
    // failing the request that was about to succeed.
  }
}

/** The verifier this browser kept for that identifier, or null. */
export function readAddressVerifier({
  identifierId,
}: {
  identifierId: string;
}): string | null {
  try {
    return sessionStorage.getItem(`${STORAGE_PREFIX}${identifierId}`);
  } catch {
    return null;
  }
}

/** Spent, superseded, or abandoned — either way it is worth nothing now. */
export function forgetAddressVerifier({
  identifierId,
}: {
  identifierId: string;
}): void {
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${identifierId}`);
  } catch {
    // Nothing to do: an unreadable store is an empty one for our purposes.
  }
}
