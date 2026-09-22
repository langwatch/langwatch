/**
 * Shared validation for a catalog include list: the one and only way a model
 * or table enters its store's derived-view catalog (see
 * {@link ./postgresIncludedModels.ts} and {@link ./includedTables.ts}).
 *
 * Both the Postgres and ClickHouse derivations resolve their include list the
 * same way — reject an entry naming nothing in the manifest, reject a
 * duplicate — so this is the one place that check is written.
 */

/** What an include-list entry is validated against, for the error message. */
export interface IncludeListCheck {
  /** The include list itself, in declaration order. */
  readonly include: readonly string[];
  /** Every name the manifest actually carries. */
  readonly known: ReadonlySet<string>;
  /** The catalog half this list gates, e.g. "postgres catalog" or "catalog". */
  readonly label: string;
  /** What an entry names, e.g. "model" or "table". */
  readonly kind: string;
}

/**
 * Resolves an include list to the set of entries it names, refusing an entry
 * that names nothing in the manifest and a duplicate entry — the two ways an
 * include list stops describing the schema it is supposed to gate.
 */
export function assertIncludeEntries({
  include,
  known,
  label,
  kind,
}: IncludeListCheck): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const entry of include) {
    if (!known.has(entry)) {
      throw new Error(
        `lwql ${label}: include entry "${entry}" names no manifest ${kind}`,
      );
    }
    if (seen.has(entry)) {
      throw new Error(
        `lwql ${label}: include entry "${entry}" is listed more than once`,
      );
    }
    seen.add(entry);
  }
  return seen;
}
