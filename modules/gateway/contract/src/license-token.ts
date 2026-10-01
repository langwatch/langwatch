/**
 * The credential a connected install presents on `/resolve-key` (ADR-156): `lwl_` and a SHA-256.
 * The gateway looks a key up by a second hash of it, so a stored hash is never a credential.
 */

export const LICENSE_TOKEN_PREFIX = "lwl_";

const LICENSE_TOKEN_SHAPE = /^lwl_[0-9a-f]{64}$/;

/** Whether a presented credential has the shape of a license token. */
export function isLicenseTokenShape(value: string): boolean {
  return LICENSE_TOKEN_SHAPE.test(value);
}

/** What a managed key stores and is looked up by: the SHA-256 of the whole token, as hex. */
export async function registryHashForToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
