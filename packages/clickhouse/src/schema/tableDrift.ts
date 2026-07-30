import type { TableDescription } from "./defineTable.js";

/**
 * What a live ClickHouse reports about one table, reduced to the facts
 * `TableDescription` also carries — the shape a `defineTable` drift check
 * compares against (ADR-099). `columns` is ordered by `system.columns`'
 * `position`, so index order in the array *is* physical column order.
 */
export interface DeployedTableInfo {
  readonly engineFull: string;
  readonly sortingKey: string;
  readonly partitionKey: string;
  readonly createTableQuery: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
}

/**
 * Thrown by {@link assertNoDrift}. Carries every disagreement found, not just
 * the first — a Friday debugging session should not have to fix one, rerun,
 * and discover a second.
 */
export class TableDriftError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `schema drift detected:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "TableDriftError";
    this.issues = issues;
  }
}

function engineIssue(
  description: TableDescription,
  deployed: DeployedTableInfo,
): string | undefined {
  const prefix = `table "${description.name}"`;
  const { merge } = description;

  if (merge.kind === "replacing") {
    const expected = `ReplacingMergeTree(${merge.version})`;
    if (!deployed.engineFull.startsWith(expected)) {
      return `${prefix}: declared replacing(version="${merge.version}") but the deployed engine is "${deployed.engineFull}"`;
    }
    return undefined;
  }

  if (merge.kind === "aggregating") {
    if (!deployed.engineFull.startsWith("AggregatingMergeTree")) {
      return `${prefix}: declared aggregating() but the deployed engine is "${deployed.engineFull}"`;
    }
    return undefined;
  }

  // append(): a plain MergeTree, or a ReplacingMergeTree whose sort key
  // already carries per-record identity (ADR-099). `engine_full` carries the
  // whole tail (PARTITION BY / ORDER BY / SETTINGS), not just the engine
  // name, so this checks a prefix exactly like the other two merge kinds do.
  if (
    !deployed.engineFull.startsWith("MergeTree") &&
    !deployed.engineFull.startsWith("ReplacingMergeTree(")
  ) {
    return `${prefix}: declared append() but the deployed engine is "${deployed.engineFull}"`;
  }
  return undefined;
}

function sortKeyIssue(
  description: TableDescription,
  deployed: DeployedTableInfo,
): string | undefined {
  const declared = description.sortKey.join(", ");
  if (declared !== deployed.sortingKey) {
    return `table "${description.name}": declared sort key (${declared}) but the deployed sort key is (${deployed.sortingKey})`;
  }
  return undefined;
}

function partitionIssue(
  description: TableDescription,
  deployed: DeployedTableInfo,
): string | undefined {
  if (description.partition.by !== deployed.partitionKey) {
    return `table "${description.name}": declared partition "${description.partition.by}" but the deployed partition is "${deployed.partitionKey}"`;
  }
  return undefined;
}

function ttlIssue(
  description: TableDescription,
  deployed: DeployedTableInfo,
): string | undefined {
  if (!description.ttl) return undefined;
  const marker = `TTL ${description.ttl.anchor}`;
  if (!deployed.createTableQuery.includes(marker)) {
    return `table "${description.name}": declared TTL anchor "${description.ttl.anchor}" but the deployed DDL has no "${marker}" clause`;
  }
  return undefined;
}

/**
 * Column drift: every declared column must exist, with the declared type,
 * and the declared columns must appear as an ordered subsequence of the
 * deployed table's physical column order. A subsequence, not a prefix,
 * because a `defineTable` declaration is the row shape the codec reads and
 * writes — it need not enumerate platform bookkeeping columns a later
 * migration appended (`event_log`'s `_retention_days`/`_size_bytes`, added by
 * `00032`/`00049`/`00050` for retention accounting, are never read or written
 * by the codec and are deliberately absent from `eventLogTable`). What must
 * never happen is two declared columns swapping relative order against the
 * deployed table — that is the one shape of drift a subsequence check still
 * catches.
 */
function columnIssues(
  description: TableDescription,
  deployed: DeployedTableInfo,
): string[] {
  const prefix = `table "${description.name}"`;
  const issues: string[] = [];
  const positionByName = new Map(
    deployed.columns.map((column, index) => [column.name, index]),
  );
  const typeByName = new Map(
    deployed.columns.map((column) => [column.name, column.type]),
  );

  let lastPosition = -1;
  for (const name of description.columnNames) {
    const declaredType = description.columnTypes[name]!;
    const position = positionByName.get(name);

    if (position === undefined) {
      issues.push(
        `${prefix}: column "${name}" is declared but not present in the deployed table`,
      );
      continue;
    }

    const deployedType = typeByName.get(name)!;
    if (deployedType !== declaredType) {
      issues.push(
        `${prefix}: column "${name}" is declared as "${declaredType}" but the deployed type is "${deployedType}"`,
      );
    }

    if (position <= lastPosition) {
      issues.push(
        `${prefix}: column "${name}" is declared out of order — it comes earlier in the declaration than in the deployed table`,
      );
    }
    lastPosition = Math.max(lastPosition, position);
  }

  return issues;
}

/**
 * Every disagreement between `description` (a `defineTable().describe()`)
 * and `deployed` (read back from a live ClickHouse). Empty when the two
 * agree. Each issue names the table, the field, and both values — "schema
 * mismatch" alone is not a usable message.
 */
export function findTableDrift(
  description: TableDescription,
  deployed: DeployedTableInfo,
): string[] {
  return [
    engineIssue(description, deployed),
    sortKeyIssue(description, deployed),
    partitionIssue(description, deployed),
    ttlIssue(description, deployed),
    ...columnIssues(description, deployed),
  ].filter((issue): issue is string => issue !== undefined);
}

/** Throws {@link TableDriftError} if `description` and `deployed` disagree on any dimension {@link findTableDrift} checks. */
export function assertNoDrift(
  description: TableDescription,
  deployed: DeployedTableInfo,
): void {
  const issues = findTableDrift(description, deployed);
  if (issues.length > 0) {
    throw new TableDriftError(issues);
  }
}
