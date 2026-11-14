/**
 * How a LangWatchQL view keeps one row per logical record: the strategy and what it reads.
 * @see ../features/provisioning/services/langwatch-ql-view-dedup.service.ts: how each renders
 */

/** How a view collapses its source's rows to one per logical record. */
export type LangWatchQLDedupStrategy =
  | "in-tuple"
  | "final"
  | "latest-in-order"
  | "settled"
  | "none";

/** The strategies whose view gets a floored twin when its dedup declares a floor column. */
export const FLOORED_DEDUP_STRATEGIES: ReadonlySet<LangWatchQLDedupStrategy> = new Set([
  "in-tuple",
  "settled",
]);

/** What identifies one row of a view, and how the source's versions collapse to it. */
export interface LangWatchQLViewDedup {
  /**
   * The source table's `ORDER BY`: the key its engine collapses on.
   */
  readonly keyColumns: readonly string[];
  /**
   * The strategy this dataset needs, when the shipped default is wrong for it.
   */
  readonly strategy?: LangWatchQLDedupStrategy;
  /**
   * The engine's version column: `argMax`/`max` over this picks the survivor.
   */
  readonly versionColumn?: string;
  /**
   * Under `latest-in-order`: columns compared after the version when two versions tie, so a
   * replay's row (a newer `Version`) wins where `FINAL` would keep the last insert (ADR-006).
   */
  readonly tieBreakColumns?: readonly string[];
  /**
   * Under `latest-in-order`: source columns no version of a row changes, grouped beside the sort
   * key so a caller's range on them reaches the table's partition and primary key (ADR-006).
   */
  readonly stableColumns?: readonly string[];
  /**
   * Set when the source is an `AggregatingMergeTree`, whose rows for one key are
   * *summed together* rather than one superseding the others.
   */
  readonly aggregating?: boolean;
  /**
   * Under `settled`: the source's sign column (+1 a row, -1 its retraction). The view keeps the
   * rows whose signs sum above zero and never exposes it (analytics ADR-007).
   */
  readonly signColumn?: string;
  /**
   * An in-tuple dataset's column that never falls from one version of a row to the next, so a
   * read bounded below on it may dedup from that bound alone (analytics ADR-005). Under
   * `settled`, any column a retraction copies unchanged (analytics ADR-007).
   */
  readonly floorColumn?: string;
}
