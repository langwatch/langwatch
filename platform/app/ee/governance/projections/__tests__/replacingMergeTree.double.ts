// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A `ReplacingMergeTree` the rebuild tests can actually run against.
 *
 * The rebuild guarantees ADR-075 Class C (retired; ground now ADR-098) has
 * to satisfy are properties of
 * the projection AND the table's engine together: the derivation makes a
 * re-derived row identical, and the engine collapses it onto the row it
 * re-derives. Asserting only on the derivation would leave the half that
 * fails silently in production untested, and a unit test cannot reach a
 * real ClickHouse.
 *
 * So this models exactly the two engine properties the migrations declare,
 * and nothing else:
 *
 *   - rows collapse by the table's ORDER BY (the dedup key);
 *   - the surviving row is the one with the highest version, and on a tie
 *     the last inserted — which is also what an omitted version column
 *     degenerates to (`DEFAULT now64(3)`, i.e. insertion order).
 *
 * `parts()` is what a plain `SELECT` sees before a merge runs;
 * `merged()` is the settled state. Both matter: the audit read path is
 * cursor-paginated and the KPI read path is a bare `sum(...)`, so a test
 * that only looked at the settled state would miss a shape that
 * over-counts for as long as a merge is pending.
 */

export interface ReplacingMergeTreeDoubleOptions<Row> {
  /**
   * The table's ORDER BY, rendered as a comparable string. Must mirror the
   * migration — that is the point of the double.
   */
  orderBy: (row: Row) => string;
  /**
   * The table's version column. Omit to model a column the writer leaves
   * to `DEFAULT now64(3)`: insertion order decides, so the last write wins.
   */
  version?: (row: Row) => number;
}

export class ReplacingMergeTreeDouble<Row> {
  private readonly rows: Array<{ row: Row; sequence: number }> = [];
  private sequence = 0;

  constructor(private readonly options: ReplacingMergeTreeDoubleOptions<Row>) {}

  insert(rows: readonly Row[]): void {
    for (const row of rows) {
      this.rows.push({ row, sequence: this.sequence++ });
    }
  }

  /** Every inserted row, in insertion order — the pre-merge `SELECT`. */
  parts(): Row[] {
    return this.rows.map(({ row }) => row);
  }

  /**
   * The settled state after dedup-by-key.
   *
   * **The ORDER of the returned rows is an artifact of this double, not a
   * property of ClickHouse.** Survivors come back in insertion order because
   * that is the cheapest thing to model; a real `SELECT ... FINAL` orders
   * nothing without an explicit `ORDER BY`. Assert on the SET of survivors —
   * membership, count, which row won a key — never on the sequence they
   * arrive in, or the test pins a guarantee production does not offer.
   */
  merged(): Row[] {
    const survivors = new Map<string, { row: Row; sequence: number }>();
    for (const entry of this.rows) {
      const key = this.options.orderBy(entry.row);
      const held = survivors.get(key);
      if (!held) {
        survivors.set(key, entry);
        continue;
      }
      if (this.options.version) {
        const heldVersion = this.options.version(held.row);
        const nextVersion = this.options.version(entry.row);
        if (nextVersion < heldVersion) continue;
        // Equal versions: ClickHouse keeps the last row of the selection.
      }
      survivors.set(key, entry);
    }
    return [...survivors.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ row }) => row);
  }
}
