import {
  CredentialsResealRepository,
  type SealedCandidate,
  type SealedColumn,
  type SealedReplacement,
} from "../credentials-reseal.repository.ts";

type MemoryColumn = { table: string; column: string; rows: Map<string, string> };

/**
 * Columns of id-keyed text values held in memory. A memory process holds none, so
 * the walk finds nothing; a test pushes the columns it re-seals.
 */
export class MemoryCredentialsResealRepository extends CredentialsResealRepository {
  readonly columns: MemoryColumn[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryCredentialsResealRepository {
    return new MemoryCredentialsResealRepository();
  }

  findColumns(): Promise<SealedColumn[]> {
    return Promise.resolve(
      this.columns.map(({ table, column }) => ({
        table,
        column,
        type: "text",
        keys: [{ column: "id", type: "text" }],
      })),
    );
  }

  findCandidates({
    column,
    after,
    limit,
  }: {
    column: SealedColumn;
    after: readonly string[] | null;
    limit: number;
  }): Promise<SealedCandidate[]> {
    const last = after?.[0];
    const page = [...this.rowsOf(column)]
      .filter(([id]) => last === undefined || id > last)
      .toSorted(([left], [right]) => (left < right ? -1 : 1))
      .slice(0, limit)
      .map(([id, value]) => ({ key: [id], value }));
    return Promise.resolve(page);
  }

  replaceValues({
    column,
    rows,
  }: {
    column: SealedColumn;
    rows: readonly SealedReplacement[];
  }): Promise<number> {
    const stored = this.rowsOf(column);
    let written = 0;
    for (const row of rows) {
      const id = row.key[0] ?? "";
      if (stored.get(id) !== row.expected) continue;
      stored.set(id, row.value);
      written += 1;
    }
    return Promise.resolve(written);
  }

  private rowsOf({ table, column }: { table: string; column: string }): Map<string, string> {
    const found = this.columns.find((each) => each.table === table && each.column === column);
    return found ? found.rows : new Map<string, string>();
  }
}
