const STORAGE_PREFIX = "langwatch.passkey-signup-claim:";

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newClaim(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * One unguessable claim per address and browser tab. A retry reuses it, while
 * another browser cannot adopt an unfinished account left by this ceremony.
 */
export function passkeySignUpContext(email: string): string {
  const normalized = normalizedEmail(email);
  const key = `${STORAGE_PREFIX}${normalized}`;
  let claim = sessionStorage.getItem(key);
  if (!claim) {
    claim = newClaim();
    sessionStorage.setItem(key, claim);
  }
  return JSON.stringify({ email: normalized, claim });
}
