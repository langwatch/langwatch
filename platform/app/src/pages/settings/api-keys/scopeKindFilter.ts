import type { FilterChipItem } from "~/components/ui/FilterChips";

/**
 * The levels of the organization tree an API key's role bindings can sit on.
 *
 * These are the only scope kinds the key model has. A personal key's reach is
 * the bindings copied from the person who owns it, so "who owns this key" is a
 * column on the row, never a fourth level here.
 */
export const API_KEY_SCOPE_KINDS = ["ORGANIZATION", "TEAM", "PROJECT"] as const;

export type ApiKeyScopeKind = (typeof API_KEY_SCOPE_KINDS)[number];

/** The active chip: every key, or one level of the tree. */
export type ScopeKindFilter = "all" | ApiKeyScopeKind;

export const ALL_SCOPE_KINDS: ScopeKindFilter = "all";

const SCOPE_KIND_LABELS: Record<ApiKeyScopeKind, string> = {
  ORGANIZATION: "Organization",
  TEAM: "Team",
  PROJECT: "Project",
};

/** Narrow enough that a stray string from a URL or a stale row cannot pass. */
export function isApiKeyScopeKind(value: string): value is ApiKeyScopeKind {
  return (API_KEY_SCOPE_KINDS as readonly string[]).includes(value);
}

type KeyWithBindings = { roleBindings: Array<{ scopeType: string }> };

/**
 * Whether a key belongs under the given chip. A key is bound at a level if ANY
 * of its bindings sits there, so a key bound at the organization AND on one
 * project belongs under both — the same key, seen from two levels, not two
 * keys.
 */
export function keyMatchesScopeKind(
  key: KeyWithBindings,
  filter: ScopeKindFilter,
): boolean {
  if (filter === ALL_SCOPE_KINDS) return true;
  return key.roleBindings.some((binding) => binding.scopeType === filter);
}

export function filterKeysByScopeKind<T extends KeyWithBindings>(
  keys: T[],
  filter: ScopeKindFilter,
): T[] {
  if (filter === ALL_SCOPE_KINDS) return keys;
  return keys.filter((key) => keyMatchesScopeKind(key, filter));
}

/**
 * The chips to render for a set of keys, in tree order: every key first, then
 * each level that actually holds one.
 *
 * A level with nothing behind it is left out rather than rendered at zero: a
 * dead chip is a row of identical grey pills that says nothing and still asks
 * to be read. The counts overlap on purpose (see {@link keyMatchesScopeKind}),
 * which is why they can add up to more than the total — {@link SCOPE_KIND_OVERLAP_NOTE}
 * is the sentence that says so.
 *
 * The caller passes the keys the rest of the page would show, so the counts
 * always describe the rows on screen rather than the whole organization.
 */
export function buildScopeKindChips(keys: KeyWithBindings[]): FilterChipItem[] {
  const chips: FilterChipItem[] = [
    { value: ALL_SCOPE_KINDS, label: "All keys", count: keys.length },
  ];

  for (const kind of API_KEY_SCOPE_KINDS) {
    const count = keys.filter((key) => keyMatchesScopeKind(key, kind)).length;
    if (count > 0) {
      chips.push({ value: kind, label: SCOPE_KIND_LABELS[kind], count });
    }
  }

  return chips;
}

export const SCOPE_KIND_OVERLAP_NOTE =
  "A key that reaches more than one level is counted under each of them.";
