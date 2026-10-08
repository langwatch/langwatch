/**
 * Latest-version dedup for ReplacingMergeTree reads that aggregate over every
 * key in a time range (analytics timeseries).
 *
 * The IN-tuple form (`(TenantId, Key, UpdatedAt) IN (SELECT ..., max(UpdatedAt)
 * GROUP BY ...)`) builds a hash SET with one entry per key in range before the
 * outer read starts. A set cannot spill to disk, so its size grows with the
 * tenant's trace count and nothing in the query can bound it: on a high-volume
 * project a 30-day dashboard panel (60 days with the previous period) holds tens
 * of millions of entries and fails with MEMORY_LIMIT_EXCEEDED.
 *
 * This form reads the table once and collapses each key to its latest row with
 * `argMax(tuple(...), UpdatedAt)`. The per-key state lives in an aggregation
 * hash table, which `max_bytes_before_external_group_by` spills to disk, so the
 * query degrades to slower instead of failing. The carried row is a tuple so a
 * NULL in the latest version stays NULL (`argMax` on a Nullable column skips
 * NULLs and would return an older version's value).
 *
 * Semantics match the IN-tuple form: both pick the newest version among the
 * rows that pass `where`. Two rows tied on `UpdatedAt` collapse to one here,
 * where the IN-tuple form kept (and double counted) both.
 *
 * The carried row is buffered per key, so only use this when every carried
 * column is narrow. A whole `Map` column is the case to avoid: callers narrow a
 * map to the keys they read, or keep the IN-tuple form.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md "Whole-range aggregates"
 */

export interface LatestVersionColumn {
  /** Column name the outer query reads (`alias.name`). */
  name: string;
  /** Expression over the raw table row. Defaults to `name`. */
  expression?: string;
}

const LATEST_ROW = "__latest_row";
const LATEST = "__latest";
const VERSION = "__version";

/**
 * Parse a column list entry: a bare identifier (`TotalCost`) or an aliased
 * expression (`map('k', Attributes['k']) AS Attributes`).
 */
export function parseLatestVersionColumn(entry: string): LatestVersionColumn {
  const aliased = /^([\s\S]+?)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(
    entry.trim(),
  );
  if (aliased) {
    return { name: aliased[2]!, expression: aliased[1]!.trim() };
  }
  return { name: entry.trim() };
}

/**
 * The columns the collapse carries in its tuple: every requested column once,
 * minus the keys (grouped on directly) and the bare version column (exposed as
 * `max(version)`).
 */
function splitCarriedColumns({
  keyColumns,
  columns,
  versionColumn,
}: {
  keyColumns: readonly string[];
  columns: readonly LatestVersionColumn[];
  versionColumn: string;
}): { carried: LatestVersionColumn[]; carriesVersion: boolean } {
  const keys = new Set(keyColumns);
  const seen = new Set<string>();
  const carried: LatestVersionColumn[] = [];
  let carriesVersion = false;
  for (const column of columns) {
    if (column.name === versionColumn && !column.expression) {
      carriesVersion = true;
    } else if (!keys.has(column.name) && !seen.has(column.name)) {
      seen.add(column.name);
      carried.push(column);
    }
  }
  return { carried, carriesVersion };
}

/**
 * Derived table holding the newest version of each key in range.
 *
 * Shape:
 *
 *   (
 *     SELECT <keys>, argMax(__latest_row, __version) AS __latest,
 *            tupleElement(__latest, 1) AS <col1>, ...
 *     FROM (
 *       SELECT <keys>, tuple(<col1 expr>, ...) AS __latest_row,
 *              <versionColumn> AS __version
 *       FROM <table> [AS <sourceAlias>]
 *       WHERE <where>
 *     )
 *     GROUP BY <keys>
 *   ) <alias>
 *
 * `where` is applied to every version row before the collapse, exactly where
 * the IN-tuple form applied it, and must carry the tenant and partition
 * predicates. Column expressions are evaluated per version row too, so a
 * predicate carried as a column (e.g. a filter verdict) is the verdict of the
 * latest version. When `sourceAlias` is given the raw table is aliased with it,
 * so expressions written against the outer alias (`ta.X`) evaluate unchanged.
 */
export function latestVersionSubquery({
  table,
  alias,
  keyColumns,
  columns,
  where,
  versionColumn = "UpdatedAt",
  sourceAlias,
}: {
  table: string;
  alias: string;
  keyColumns: readonly string[];
  columns: readonly LatestVersionColumn[];
  where: string;
  versionColumn?: string;
  sourceAlias?: string;
}): string {
  const { carried, carriesVersion } = splitCarriedColumns({
    keyColumns,
    columns,
    versionColumn,
  });

  const sourceRef = sourceAlias ? `${sourceAlias}.` : "";
  const innerSelect = [
    ...keyColumns.map((key) => `${sourceRef}${key} AS ${key}`),
    `${sourceRef}${versionColumn} AS ${VERSION}`,
  ];
  const outerSelect = [...keyColumns];
  if (carried.length > 0) {
    innerSelect.push(
      `tuple(${carried.map((c) => c.expression ?? `${sourceRef}${c.name}`).join(", ")}) AS ${LATEST_ROW}`,
    );
    outerSelect.push(`argMax(${LATEST_ROW}, ${VERSION}) AS ${LATEST}`);
    carried.forEach((column, index) => {
      outerSelect.push(
        `tupleElement(${LATEST}, ${index + 1}) AS ${column.name}`,
      );
    });
  }
  if (carriesVersion) {
    outerSelect.push(`max(${VERSION}) AS ${versionColumn}`);
  }

  return `(
    SELECT ${outerSelect.join(", ")}
    FROM (
      SELECT ${innerSelect.join(", ")}
      FROM ${table}${sourceAlias ? ` AS ${sourceAlias}` : ""}
      WHERE ${where}
    )
    GROUP BY ${keyColumns.join(", ")}
  ) ${alias}`;
}

/**
 * Narrow a `Map` column to a reconstructed map of the keys a query reads, when
 * every reference to it is a literal keyed access (`Attributes['key']`).
 *
 * Returns the projection (`map('k', Attributes['k']) AS Attributes`), or `null`
 * when the map is used generically (`mapKeys(Attributes)`, a parameterised key
 * `Attributes[{p:String}]`) and no key list covers every read.
 */
export function narrowMapColumnProjection({
  column,
  alias,
  expressions,
}: {
  column: string;
  alias: string;
  expressions: readonly string[];
}): string | null {
  const joined = expressions.join(" ");
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = `(?<![\\w."])(?:${alias}\\.)?${escapedColumn}`;
  const allRefs = joined.match(new RegExp(`${prefix}\\b`, "g")) ?? [];
  const keyed = [
    ...joined.matchAll(new RegExp(`${prefix}\\['([^'\\]\\\\]+)'\\]`, "g")),
  ];
  if (keyed.length === 0 || keyed.length !== allRefs.length) return null;
  const keys = [...new Set(keyed.map((match) => match[1]!))];
  const entries = keys.map((key) => `'${key}', ${column}['${key}']`).join(", ");
  return `map(${entries}) AS ${column}`;
}
