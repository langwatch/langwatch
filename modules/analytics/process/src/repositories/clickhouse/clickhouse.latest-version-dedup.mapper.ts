/**
 * Latest-version dedup by `argMax(tuple(...), UpdatedAt)` for reads that aggregate
 * over a whole range: its per-key state spills, where the IN-tuple set cannot. The
 * tuple keeps a NULL in the latest version NULL. Carry only narrow columns.
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
  const aliased = /^([\s\S]+?)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(entry.trim());
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
}): { carried: LatestVersionColumn[]; isVersionCarried: boolean } {
  const keys = new Set(keyColumns);
  const seen = new Set<string>();
  const carried: LatestVersionColumn[] = [];
  let isVersionCarried = false;
  for (const column of columns) {
    if (column.name === versionColumn && !column.expression) {
      isVersionCarried = true;
    } else if (!keys.has(column.name) && !seen.has(column.name)) {
      seen.add(column.name);
      carried.push(column);
    }
  }
  return { carried, isVersionCarried };
}

/**
 * Newest version of each key in range. `where` and column expressions run on every
 * version row, so `where` carries the tenant and partition predicates; `sourceAlias`
 * aliases the raw table so expressions written against the outer alias still resolve.
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
  const { carried, isVersionCarried } = splitCarriedColumns({
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
      outerSelect.push(`tupleElement(${LATEST}, ${index + 1}) AS ${column.name}`);
    });
  }
  if (isVersionCarried) {
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
