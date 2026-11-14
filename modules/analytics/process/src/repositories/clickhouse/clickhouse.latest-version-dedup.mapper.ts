/**
 * Latest-version dedup for ReplacingMergeTree reads over every key in a range. The IN-tuple hash
 * set cannot spill (MEMORY_LIMIT_EXCEEDED); this collapses keys with a spillable `argMax(tuple)`.
 * Carry only narrow columns (narrow a `Map` to the keys read): clickhouse-queries.md.
 */

export interface LatestVersionColumn {
  /** The column, or the alias of `expression`; read outside under its latestVersionKey. */
  name: string;
  /** Expression over the raw table row. Defaults to `name`. */
  expression?: string;
}

/** Columns whose own names the fence reads, so no alias may take them (ADR-201 §3). */
const RENAMED_KEYS: Readonly<Record<string, string>> = {
  OccurredAt: "LatestOccurredAt",
  UpdatedAt: "LatestUpdatedAt",
};

/** The name a deduped read exposes `column` under: its own, or a `Latest` one for a fenced name. */
export function latestVersionKey(column: string): string {
  return RENAMED_KEYS[column] ?? column;
}

/** The column a deduped read's key names: the inverse of {@link latestVersionKey}. */
export function latestVersionColumnOf(key: string): string {
  return Object.keys(RENAMED_KEYS).find((column) => RENAMED_KEYS[column] === key) ?? key;
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
 * Derived table of the newest version of each key in range: `argMax(__latest_row, __version)`
 * grouped by the keys, unpacked per column under {@link latestVersionKey}. `where` applies to
 * every version row before the collapse and must carry the tenant and partition predicates.
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
    ...keyColumns.map((key) => `${sourceRef}${key}`),
    `${sourceRef}${versionColumn} AS ${VERSION}`,
  ];
  const outerSelect = [...keyColumns];
  if (carried.length > 0) {
    innerSelect.push(
      `tuple(${carried.map((c) => c.expression ?? `${sourceRef}${c.name}`).join(", ")}) AS ${LATEST_ROW}`,
    );
    outerSelect.push(`argMax(${LATEST_ROW}, ${VERSION}) AS ${LATEST}`);
    carried.forEach((column, index) => {
      outerSelect.push(`tupleElement(${LATEST}, ${index + 1}) AS ${latestVersionKey(column.name)}`);
    });
  }
  if (isVersionCarried) {
    outerSelect.push(`max(${VERSION}) AS ${latestVersionKey(versionColumn)}`);
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
