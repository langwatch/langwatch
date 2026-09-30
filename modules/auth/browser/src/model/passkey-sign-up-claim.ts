const STORAGE_PREFIX = "langwatch.passkey-signup-claim:";

function newClaim(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * The passkey sign-up ceremony's registration `context`: one unguessable claim per address
 * and browser tab, so a retry reuses it while another browser cannot adopt the ceremony.
 */
export function passkeySignUpContext({
  email,
  addressProof,
}: {
  email: string;
  addressProof?: string;
}): string {
  const normalized = email.trim().toLowerCase();
  const key = `${STORAGE_PREFIX}${normalized}`;
  let claim = sessionStorage.getItem(key);
  if (!claim) {
    claim = newClaim();
    sessionStorage.setItem(key, claim);
  }
  return JSON.stringify({ email: normalized, claim, addressProof });
}
