/** Normalizes an identifier value: NFKC unicode fold, lowercase, trim. Keeps plus tags because they
 * route separately and represent the person's deliberate choice to keep accounts separable.
 */
export function normalizeIdentifierValue(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** The org-level routing fact; null for values that are not email-shaped. */
export function extractIdentifierDomain(normalizedValue: string): string | null {
  const at = normalizedValue.lastIndexOf("@");
  if (at <= 0 || at === normalizedValue.length - 1) return null;
  return normalizedValue.slice(at + 1);
}

/**
 * A domain as a connection claims it (D04), folded the SAME way as an
 * identifier's domain — they must agree byte for byte or routing silently
 * misses. Tolerates an operator pasting `@acme.com` or a trailing dot.
 */
export function normalizeDomain(raw: string): string {
  const folded = raw.normalize("NFKC").trim().toLowerCase();
  const withoutAt = folded.startsWith("@") ? folded.slice(1) : folded;
  return withoutAt.endsWith(".") ? withoutAt.slice(0, -1) : withoutAt;
}
