/**
 * One stored column that can hold a sealed value, with the primary key its rows
 * are addressed by. `type` and each key's `type` are the database's own type
 * names, so a value read as text is written back as what the column holds.
 */
export type SealedColumn = Readonly<{
  table: string;
  column: string;
  type: string;
  /** Empty for a table without a primary key, whose rows cannot be addressed. */
  keys: readonly Readonly<{ column: string; type: string }>[];
}>;

/** A row whose value holds something shaped like a sealed value. */
export type SealedCandidate = Readonly<{
  /** The row's primary key, one text value per key column. */
  key: readonly string[];
  value: string;
}>;

export type SealedReplacement = Readonly<{
  key: readonly string[];
  /** The value as it was read: a row that changed since is left alone. */
  expected: string;
  value: string;
}>;

/**
 * The cross-tenant walk the credentials-reseal task makes over every text and JSON
 * column of the application's schema. The column list is read from the database,
 * so a new encrypted column is covered without an edit here.
 */
export abstract class CredentialsResealRepository {
  abstract findColumns(): Promise<SealedColumn[]>;

  /** One page of candidate rows in primary-key order, starting after `after`. */
  abstract findCandidates(input: {
    column: SealedColumn;
    after: readonly string[] | null;
    limit: number;
  }): Promise<SealedCandidate[]>;

  /** Writes the page in one transaction and answers how many rows still held `expected`. */
  abstract replaceValues(input: {
    column: SealedColumn;
    rows: readonly SealedReplacement[];
  }): Promise<number>;
}
