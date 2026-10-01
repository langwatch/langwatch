/**
 * The browser's half of the address-confirmation ceremony: the PKCE verifier the
 * starting tab keeps, per identifier, so a forwarded link confirms nothing.
 * Spec: specs/identity/authentication-settings.feature
 */

const STORAGE_PREFIX = "lw.identity.address-verifier.";

/** RFC 7636 §4.1: 43-128 characters from the unreserved set. */
const VERIFIER_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws where the browser has no Web Crypto; the caller reports a failure to start. */
export async function mintAddressCeremony(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("this browser exposes no Web Crypto, so no verification can be started here");
  }
  const codeVerifier = base64url(globalThis.crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64url(new Uint8Array(digest)) };
}

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
    // Blocked storage can still start the ceremony; the landing says it cannot finish here.
  }
}

/** The verifier this tab kept for that identifier; empty when it kept none. */
export function findAddressVerifiers({ identifierId }: { identifierId: string }): string[] {
  try {
    const kept = sessionStorage.getItem(`${STORAGE_PREFIX}${identifierId}`);
    return kept ? [kept] : [];
  } catch {
    return [];
  }
}

export function forgetAddressVerifier({ identifierId }: { identifierId: string }): void {
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${identifierId}`);
  } catch {
    // An unreadable store is an empty one for our purposes.
  }
}
