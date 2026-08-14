import { canonicalizeEmailLike } from "@langwatch/identity-links";

/**
 * Marker left where a person's identifier used to sit inside a
 * `DiscoveredAgent.snapshot` payload.
 *
 * A marker rather than a deletion: the snapshot is provider-side state whose
 * shape other code reads, and a key that vanishes is indistinguishable from a
 * provider that stopped sending it. `null` would say "the provider sent no
 * owner", which is a different and untrue statement.
 */
export const ERASED_SNAPSHOT_VALUE = "[erased]" as const;

/**
 * What a person is called inside provider payloads. Emails are matched
 * canonically (providers disagree on case); opaque ids are matched exactly,
 * because lowercasing them would be a corruption rather than a normalization.
 */
export interface PersonIdentifiers {
  /** Our user id — providers echo it back in owner fields we populated. */
  userId: string;
  /** Canonical email-shaped values from the person's link rows and account. */
  emails: readonly string[];
  /** Provider-side actor ids from the person's link rows (objectId, member id…). */
  providerActorIds: readonly string[];
}

interface CompiledIdentifiers {
  exact: Set<string>;
  emails: readonly string[];
}

const compile = (identifiers: PersonIdentifiers): CompiledIdentifiers => {
  const emails = [...new Set(identifiers.emails.map(canonicalizeEmailLike))]
    .filter((email) => email !== "")
    .sort((a, b) => b.length - a.length);
  return {
    exact: new Set(
      [identifiers.userId, ...identifiers.providerActorIds].filter(
        (value) => value !== "",
      ),
    ),
    emails,
  };
};

/**
 * Blank one string leaf. Three cases, in order:
 *
 * 1. It IS an identifier (our user id, a provider actor id, or an email in any
 *    casing) — the whole value goes.
 * 2. It CONTAINS an email — display strings like `Alice <alice@example.com>`
 *    still name the person, so the address inside is replaced and the rest of
 *    the string survives. Longest-first so one address is never half-erased by
 *    a shorter one that happens to be its prefix.
 * 3. Neither — untouched. Erasure blanks who somebody was, never what a
 *    provider reported about a bot.
 *
 * Substring matching is deliberately NOT applied to opaque ids: they are short,
 * high-entropy and routinely appear as fragments of unrelated composite keys,
 * so a contains-rule there would blank inventory data that names nobody.
 */
const eraseString = (
  value: string,
  { exact, emails }: CompiledIdentifiers,
): string => {
  if (exact.has(value)) return ERASED_SNAPSHOT_VALUE;

  const canonical = canonicalizeEmailLike(value);
  if (emails.includes(canonical)) return ERASED_SNAPSHOT_VALUE;

  let result = value;
  for (const email of emails) {
    if (!canonicalizeEmailLike(result).includes(email)) continue;
    // Case-insensitive replacement of every occurrence, without regex: an
    // email is arbitrary user input and would need escaping to be a safe
    // pattern.
    result = replaceAllInsensitive(result, email, ERASED_SNAPSHOT_VALUE);
  }
  return result;
};

const replaceAllInsensitive = (
  haystack: string,
  needle: string,
  replacement: string,
): string => {
  let out = "";
  let rest = haystack;
  for (;;) {
    const at = rest.toLowerCase().indexOf(needle);
    if (at === -1) return out + rest;
    out += rest.slice(0, at) + replacement;
    rest = rest.slice(at + needle.length);
  }
};

/**
 * Walk a `DiscoveredAgent.snapshot` payload and blank every person reference
 * in it (ADR-094 Decision 9), returning the rewritten payload and whether
 * anything actually changed — the caller only writes, and only stamps
 * `erasedAt`, on rows that did.
 *
 * Object KEYS are walked as well as values. A provider that buckets state by
 * owner (`{"alice@example.com": {...}}`) names the person in the key, and a
 * pass that only looked at values would leave the name sitting in plain sight
 * while reporting success.
 */
export const eraseSnapshotPersonReferences = (
  snapshot: unknown,
  identifiers: PersonIdentifiers,
): { snapshot: unknown; changed: boolean } => {
  const compiled = compile(identifiers);
  if (compiled.exact.size === 0 && compiled.emails.length === 0) {
    return { snapshot, changed: false };
  }

  let changed = false;
  const scrub = (value: string): string => {
    const erased = eraseString(value, compiled);
    if (erased !== value) changed = true;
    return erased;
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return scrub(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [scrub(key), walk(value)]),
      );
    }
    return node;
  };

  const result = walk(snapshot);
  return { snapshot: changed ? result : snapshot, changed };
};
