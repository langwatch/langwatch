/**
 * The HTTP agent's hooks signing secret as the form makes it (ADR-188). The browser makes it, so
 * the person sees it once before saving; the save stores it as a project secret.
 */

const SECRET_BYTES = 32;

/** A new signing secret: `whsec_` and 64 lower-case hex characters. */
export function newHooksSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `whsec_${hex}`;
}
