/**
 * Normalization at attach (D01): NFKC unicode fold, lowercase, trim. Applied
 * once, where the fact is made; only the normalized form ever reaches an event
 * or the projection.
 *
 * A plus tag is part of the address and is KEPT. `sam+work@acme.com` and
 * `sam@acme.com` are two identifiers, because to everyone outside this
 * function they are two addresses: the person typed one of them, their
 * provider routes them separately, and it is the address they will type again.
 *
 * This used to strip the tag, which is the conventional defence against one
 * mailbox minting unlimited accounts. It bought little — a second address or a
 * disposable domain costs no more effort — and it charged for it twice. The
 * screen said "we sent a link to sam+work@acme.com" and the link went to
 * sam@acme.com, which is the product lying about what it just did; and an
 * address somebody chose deliberately, to keep this account separable from
 * their others, was silently merged into an account they may already hold.
 *
 * Subaddressing is not universal, which is the other half of it: on a domain
 * that treats the tag as part of the mailbox name, the stripped address is a
 * DIFFERENT mailbox, and the confirmation goes somewhere the person cannot
 * read.
 */
export function normalizeIdentifierValue(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** The org-level routing fact; null for values that are not email-shaped. */
export function identifierDomain(normalizedValue: string): string | null {
  const at = normalizedValue.lastIndexOf("@");
  if (at <= 0 || at === normalizedValue.length - 1) return null;
  return normalizedValue.slice(at + 1);
}

/**
 * A domain as a connection claims it (D04), folded the SAME way the domain
 * of a normalized identifier is. The two have to agree byte for byte or
 * routing silently misses: `identifierDomain` answers the tail of an
 * already-normalized value, so this applies the identical fold to a domain
 * typed on its own, and tolerates an operator pasting `@acme.com` or a
 * trailing dot.
 */
export function normalizeDomain(raw: string): string {
  const folded = raw.normalize("NFKC").trim().toLowerCase();
  const withoutAt = folded.startsWith("@") ? folded.slice(1) : folded;
  return withoutAt.endsWith(".") ? withoutAt.slice(0, -1) : withoutAt;
}
