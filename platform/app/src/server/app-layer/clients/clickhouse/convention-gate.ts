/**
 * Checks a ClickHouse read against our conventions, on the way out.
 *
 * ## Why this runs at run time rather than in a linter
 *
 * Most of our SQL is assembled from interpolated fragments — `WHERE
 * ${whereClause}` — and a large share of the reads are bare WHERE-fragments
 * composed into someone else's SELECT with no query of their own. No type
 * system or static reader can see the finished string. This can, because it is
 * handed the exact text about to be sent.
 *
 * The seam already existed: `detectColdScan` ran on every query through
 * `createResilientClickHouseClient`, which is the path all three client
 * constructions take. What it did wrong was run AFTER the query had already
 * cost what it cost, warn into a log nobody aggregates, and know about 11 of
 * the 33 partitioned tables. This module keeps the seam and fixes all three:
 * it reads the table list from {@link SCHEMA_CATALOGUE}, it is called before
 * the query is sent, and every violation increments a counter.
 *
 * ## Count-only, on purpose
 *
 * Nothing here throws by default, in any environment. Twenty-two of the
 * thirty-three tables have never been watched, so nobody knows how many reads
 * violate a rule in production, and promoting an unmeasured guard to a thrown
 * error is how a guard takes down the thing it was meant to protect. ADR-068
 * took the same line for windowed reads: measure first, limit second.
 *
 * The intended progression, once the counter has a release of data behind it:
 *
 *   1. read `clickhouse_convention_violation_total` and rank tables by rule;
 *   2. fix the top offenders, which is where the S3 bill actually is;
 *   3. flip dev and test to throw, via {@link CONVENTION_GATE_THROWS};
 *   4. leave production on warn permanently — a convention violation is a cost
 *      problem, and failing a customer's read to save a request is a bad trade.
 *
 * ## What it deliberately does not do
 *
 * It never rewrites a query and it never inspects results. A false positive
 * costs one counter increment and one log line; a false negative costs real
 * money. So it errs toward flagging — a projection or ORDER BY mention of the
 * partition column does NOT clear the flag, because neither prunes.
 */
import {
  type CatalogueTable,
  CONVENTION_EXEMPTIONS,
  type ConventionRule,
  SCHEMA_CATALOGUE,
} from "~/server/clickhouse/schema-catalogue";

/** One rule broken by one table in one query. */
export interface ConventionViolation {
  readonly table: CatalogueTable;
  readonly rule: ConventionRule;
}

/**
 * Whether a violation refuses the query instead of counting it.
 *
 * Off unless explicitly set. Read once at module load so a single query cannot
 * pay for an env lookup, and so the value is the same for every read in a
 * process.
 */
export const CONVENTION_GATE_THROWS =
  process.env.LANGWATCH_CLICKHOUSE_CONVENTION_GATE === "throw";

/** Strip line and block comments so they can't hide or fake a predicate. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Escapes a column or table name for embedding in a pattern. */
function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does the SQL use `column` in a filter comparison, rather than merely
 * projecting or ordering by it?
 *
 * This is the crux, and it was verified against production: a query like
 * `SELECT toUnixTimestamp64Milli(StartTime) … ORDER BY StartTimeMs` mentions
 * StartTime and still scans every partition (252 of 252 parts), while `WHERE
 * StartTime >= {from}` prunes to 41 of 255. So only an adjacency to a
 * comparison operator, BETWEEN or IN counts, on either side.
 */
function hasComparison(sql: string, column: string): boolean {
  const col = escape(column);
  const columnThenOperator = new RegExp(
    `\\b${col}\\b\\s*(?:>=|<=|<>|!=|=|>|<|\\bBETWEEN\\b|\\bIN\\b)`,
    "i",
  );
  const operatorThenColumn = new RegExp(
    `(?:>=|<=|<>|!=|=|>|<)\\s*\\b${col}\\b`,
    "i",
  );
  return columnThenOperator.test(sql) || operatorThenColumn.test(sql);
}

/**
 * Does the query read this table?
 *
 * Word-boundary matched, which is load-bearing rather than cosmetic: `\b` will
 * not match `log_records` inside `stored_log_records`, because `_` is a word
 * character. Six of the catalogue's names are suffixes of another, and a
 * substring match would attribute every `stored_log_records` read to
 * `log_records` and check it against the wrong partition column.
 */
function referencesTable(sql: string, table: string): boolean {
  return new RegExp(`\\b${escape(table)}\\b`, "i").test(sql);
}

/** Is this violation one we have registered as deliberate? */
function isExempt({
  sql,
  table,
  rule,
}: {
  sql: string;
  table: CatalogueTable;
  rule: ConventionRule;
}): boolean {
  return CONVENTION_EXEMPTIONS.some(
    (exemption) =>
      exemption.table === table &&
      exemption.rule === rule &&
      exemption.matches.test(sql),
  );
}

/**
 * Every convention this read breaks.
 *
 * Empty for anything that is not a SELECT: an INSERT names a table but reads
 * nothing, and judging it by the read rules would flag every write we make.
 */
export function findConventionViolations(query: string): ConventionViolation[] {
  if (typeof query !== "string" || query.length === 0) return [];

  const sql = stripComments(query);
  const leading = sql.trimStart().toUpperCase();
  if (!leading.startsWith("SELECT") && !leading.startsWith("WITH")) return [];

  const violations: ConventionViolation[] = [];

  for (const [name, shape] of Object.entries(SCHEMA_CATALOGUE)) {
    const table = name as CatalogueTable;
    if (!referencesTable(sql, name)) continue;

    // Only some catalogue entries declare extra prunable columns, and the
    // catalogue is `as const`, so the property has to be narrowed rather than
    // defaulted — `?? []` cannot rescue a key the type does not carry.
    const prunable =
      "prunableColumns" in shape ? (shape.prunableColumns ?? []) : [];
    const prunes = [shape.partitionColumn, ...prunable];
    if (
      !prunes.some((column) => hasComparison(sql, column)) &&
      !isExempt({ sql, table, rule: "partition_predicate" })
    ) {
      violations.push({ table, rule: "partition_predicate" });
    }

    if (
      !shape.tenantColumns.some((column) => hasComparison(sql, column)) &&
      !isExempt({ sql, table, rule: "tenant_predicate" })
    ) {
      violations.push({ table, rule: "tenant_predicate" });
    }
  }

  return violations;
}

/**
 * The table of a read that cannot prune partitions, or null.
 *
 * Kept as its own function because the cold-scan warning predates the gate and
 * reads better at the call site than filtering a violation list. It now covers
 * all 33 partitioned tables rather than the 11 its own hand-kept map knew.
 */
export function detectColdScan(query: string): CatalogueTable | null {
  const cold = findConventionViolations(query).find(
    (violation) => violation.rule === "partition_predicate",
  );
  return cold?.table ?? null;
}
