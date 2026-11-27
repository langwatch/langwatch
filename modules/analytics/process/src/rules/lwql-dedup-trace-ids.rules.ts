/**
 * LangWatchQL analytics SQL: sending a pass's read of a latest-in-order view to the view's
 * trace-ids twin, whose dedup reads only the traces the pass already holds (analytics ADR-006,
 * amendment 2026-11-24). @see specs/lwql/dedup-trace-ids.feature
 */
import { isLangWatchQLAggregateFunction } from "../features/app-functions/rules/langwatch-ql-functions.rules.ts";
import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import { clickHouseSqlParser, type SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import { qualifyTableName } from "./langwatch-ql-policy.rules.ts";
import { collectNodes, flooredViewName, getSpan, nodesOf } from "./lwql-dedup-floor.rules.ts";

/** The parameter a trace-ids twin takes the traces it reads in. */
export const LWQL_TRACE_IDS_PARAMETER = "lwql_trace_ids";

/** The view column a twin is cut by, and the one every pass restricts its rows by. */
export const LWQL_TRACE_ID_COLUMN = "TraceId";

const TRACE_IDS_SUFFIX = "__ids";

/** The trace-ids twin of a view: provisioned beside it, read only through this rewrite. */
export function traceIdsViewName(view: string): string {
  return `${view}${TRACE_IDS_SUFFIX}`;
}

/** Whether `relation`, bare or database-qualified, names a trace-ids twin. */
export function isTraceIdsViewName(relation: string): boolean {
  return relation.endsWith(TRACE_IDS_SUFFIX);
}

/** The view a trace-ids twin is cut from, else `relation` itself. */
export function traceIdsBaseViewName(relation: string): string {
  return isTraceIdsViewName(relation) ? relation.slice(0, -TRACE_IDS_SUFFIX.length) : relation;
}

/** The name a view statement creates: the view, its floored twin, or its trace-ids twin. */
export function twinViewName({
  view,
  floor,
  traceIds,
}: {
  view: string;
  floor: string | undefined;
  traceIds: string | undefined;
}): string {
  if (floor !== undefined && traceIds !== undefined) {
    throw new Error(`LangWatchQL view ${view}: a twin is floored or cut by trace, not both`);
  }
  if (floor !== undefined) return flooredViewName(view);
  return traceIds === undefined ? view : traceIdsViewName(view);
}

/**
 * Whether a view gets a trace-ids twin: a `latest-in-order` dedup (whose subquery a caller's
 * filter cannot reach) keyed by the trace, so the cut keeps or drops a key's versions together.
 */
export function hasTraceIdsTwin(view: LangWatchQLViewDefinition): boolean {
  return (
    view.dedup.strategy === "latest-in-order" &&
    view.dedup.keyColumns.includes(LWQL_TRACE_ID_COLUMN)
  );
}

/** The trace-ids twins `views` provision. */
export function traceIdsViewNames(views: readonly LangWatchQLViewDefinition[]): string[] {
  return views.filter(hasTraceIdsTwin).map(({ name }) => traceIdsViewName(name));
}

/** SELECT clauses after which a row of the result is no longer one row of the FROM relation. */
const ROW_CHANGING_CLAUSES = [
  "group_by",
  "group_by_all",
  "having",
  "window",
  "qualify",
  "limit_by",
  "limit",
  "offset",
  "limit_with_ties",
  "distinct",
  "interpolate",
] as const;

/** Whether a SELECT field holds something: a node, a non-empty list, or a set flag. */
function isSet(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== false;
}

function isWindowCall(node: SqlAstNode): boolean {
  return (
    node.kind === "WINDOW_FUNCTION" ||
    node.is_window_function === true ||
    node.window_definition !== undefined ||
    node.window_name !== undefined
  );
}

/** Whether the SELECT's own clauses, not its subqueries, collapse rows into one. */
function aggregatesRows(select: SqlAstNode): boolean {
  const ownClauses = [select.select, select.where, select.prewhere, select.order_by];
  const calls = collectNodes(
    ownClauses,
    (node) => node.type === "Function",
    (node) => node.type !== "Subquery" && node.type !== "SelectWithUnionQuery",
  );
  return calls.some(
    (call) => typeof call.name === "string" && isLangWatchQLAggregateFunction(call.name),
  );
}

/** Whether a node names the trace column, bare or through the read it qualifies. */
function isTraceColumn({ node, qualifiers }: { node: SqlAstNode; qualifiers: readonly string[] }) {
  if (node.type !== "Identifier") return false;
  const parts = nameParts(node);
  if (parts.at(-1) !== LWQL_TRACE_ID_COLUMN) return false;
  return parts.length === 1 || qualifiers.includes(parts.slice(0, -1).join("."));
}

/** Whether every result row's `TraceId` is the view row's own: projected as is, renamed by none. */
function keepsTraceColumn({
  select,
  statements,
  qualifiers,
}: {
  select: SqlAstNode;
  statements: readonly SqlAstNode[];
  qualifiers: readonly string[];
}): boolean {
  const projection = Array.isArray(select.select) ? select.select.flatMap(nodesOf) : [];
  const traceColumn = projection.find(
    (node) =>
      (isTraceColumn({ node, qualifiers }) &&
        (node.alias === undefined || node.alias === LWQL_TRACE_ID_COLUMN)) ||
      (node.type === "Asterisk" && node.transformers === undefined),
  );
  if (!traceColumn) return false;
  const renamed = collectNodes(statements, (node) => node.alias === LWQL_TRACE_ID_COLUMN);
  return renamed.every((node) => node === traceColumn);
}

/** Whether a statement reads the result's rows straight from its FROM view, one row each. */
function readsRowsOneToOne({
  select,
  statements,
}: {
  select: SqlAstNode;
  statements: readonly SqlAstNode[];
}): boolean {
  if (ROW_CHANGING_CLAUSES.some((field) => isSet(select[field]))) return false;
  const orderBy = Array.isArray(select.order_by) ? select.order_by.flatMap(nodesOf) : [];
  if (orderBy.some((element) => isSet(element.with_fill))) return false;
  if (collectNodes(statements, (node) => node.type === "Function" && isWindowCall(node)).length) {
    return false;
  }
  return !aggregatesRows(select);
}

/** Fields of a FROM table that change which rows it gives. */
const TABLE_MODIFIERS = ["final", "sample_size", "sample_offset", "column_aliases"] as const;

/** The statement's top-level SELECTs: one for a plain statement, one per branch of a UNION. */
function topSelects(statements: readonly SqlAstNode[]): SqlAstNode[] {
  return statements.flatMap((statement) => {
    if (statement.type === "SelectQuery") return [statement];
    if (statement.type !== "SelectWithUnionQuery" || !Array.isArray(statement.selects)) return [];
    return statement.selects.flatMap(nodesOf).filter((select) => select.type === "SelectQuery");
  });
}

/** The tables a FROM reads plainly; none when anything joins, expands, samples or renames one. */
function plainTables(select: SqlAstNode): SqlAstNode[] {
  const children = nodesOf(select.from)[0]?.children;
  const elements = Array.isArray(children) ? children.flatMap(nodesOf) : [];
  const expressions = elements.flatMap((element) => nodesOf(element.table_expression));
  const isPlain =
    elements.every((element) => !isSet(element.table_join) && !isSet(element.array_join)) &&
    expressions.every((expression) => !TABLE_MODIFIERS.some((field) => isSet(expression[field])));
  if (!isPlain) return [];
  return expressions
    .flatMap((expression) => nodesOf(expression.database_and_table_name))
    .filter((table) => table.type === "TableIdentifier" && typeof table.name === "string");
}

/** An identifier's name parts: `db`, `view` and `column` for `db.view.column`. */
function nameParts(node: SqlAstNode): string[] {
  return Array.isArray(node.name_parts) ? node.name_parts.map(String) : [String(node.name)];
}

/**
 * Whether anything could resolve past the twin's call: a column set or transformer (`*` with
 * `REPLACE`, `COLUMNS(...)`, a qualified star), the view's own name beside an alias, or, with
 * no alias, `db.view.column`. The twin's call answers only to the alias the rewrite gives it.
 */
function reachesPastTwin({
  statements,
  name,
  alias,
}: {
  statements: readonly SqlAstNode[];
  name: string;
  alias: string | undefined;
}): boolean {
  const reaching = collectNodes(statements, (node) => {
    if (/Columns|Transformer|^Qualified/.test(node.type) || isSet(node.transformers)) return true;
    if (node.type !== "Identifier") return false;
    const parts = nameParts(node);
    if (alias === undefined) return parts.length > 2;
    // `view.column`, `db.view.column`, and any subcolumn path under either.
    return parts.length > 1 && (parts[0] === name || (parts.length > 2 && parts[1] === name));
  });
  return reaching.length > 0;
}

/** The view read a twin may stand in for, under the name and alias the statement gave it. */
interface TwinnableRead {
  readonly table: SqlAstNode;
  readonly name: string;
  readonly alias: string | undefined;
  /** The database the view resolves in: as written, else the default. */
  readonly database: string;
}

/**
 * The statement's one plain table, when it is a twin-able view nothing else can name: not a
 * `WITH` of its name, and nothing that resolves past the twin's call ({@link reachesPastTwin}).
 */
function twinnableReads({
  statements,
  select,
  database,
  twinned,
}: {
  statements: readonly SqlAstNode[];
  select: SqlAstNode;
  database: string;
  twinned: ReadonlySet<string>;
}): TwinnableRead[] {
  const tables = plainTables(select);
  const [table] = tables;
  if (tables.length !== 1 || typeof table?.name !== "string") return [];
  const written = typeof table.database === "string" ? table.database : undefined;
  const alias = typeof table.alias === "string" ? table.alias : undefined;
  const qualified = qualifyTableName({
    table: table.name,
    database: written,
    defaultDatabase: database,
  });
  if (!twinned.has(qualified)) return [];
  const withNames = collectNodes(statements, (node) => node.type === "WithElement").map(
    ({ name }) => String(name).trim().toLowerCase(),
  );
  if (written === undefined && withNames.includes(table.name.toLowerCase())) return [];
  if (reachesPastTwin({ statements, name: table.name, alias })) return [];
  return [{ table, name: table.name, alias, database: written ?? database }];
}

/** Whether cutting `read` by trace leaves every result row of the kept traces as it was. */
function cutKeepsRows({
  statements,
  select,
  read,
}: {
  statements: readonly SqlAstNode[];
  select: SqlAstNode;
  read: TwinnableRead;
}): boolean {
  const qualifier = read.alias ?? read.name;
  const shadowed = collectNodes(
    statements,
    (node) => node !== read.table && node.alias === qualifier,
  );
  return (
    shadowed.length === 0 &&
    readsRowsOneToOne({ select, statements }) &&
    keepsTraceColumn({ select, statements, qualifiers: [qualifier] })
  );
}

/** A statement as a pass sends it, and the trace-ids twin it reads, if any. */
export interface LangWatchQLTraceIdsCut {
  readonly sql: string;
  /** The twin it reads as `database.name`; absent, `sql` is as written. */
  readonly twin: string | undefined;
}

/** `sql` with `read` replaced by its twin's call, aliased to the view's name when it had none. */
function withTwin({
  sql,
  read,
  traceIds,
}: {
  sql: string;
  read: TwinnableRead;
  traceIds: string;
}): LangWatchQLTraceIdsCut {
  const span = getSpan(read.table);
  const text = sql.slice(span.start, span.end);
  if (!text.endsWith(read.name)) return { sql, twin: undefined };
  const twinName = traceIdsViewName(read.name);
  const call =
    `${text.slice(0, text.length - read.name.length)}${twinName}` +
    `(${LWQL_TRACE_IDS_PARAMETER} = ${traceIds})`;
  const replacement = read.alias === undefined ? `${call} AS ${read.name}` : call;
  const twin = `${read.database}.${twinName}`;
  return { sql: `${sql.slice(0, span.start)}${replacement}${sql.slice(span.end)}`, twin };
}

/**
 * `sql` with its FROM view read through its trace-ids twin, cut by `traceIds` (a parameter or
 * an array literal), when the cut cannot change a row of those traces ({@link cutKeepsRows}).
 * Anything else, and a statement that does not parse, is sent as written.
 */
export function restrictLangWatchQLToTraceIds({
  sql,
  database,
  views,
  traceIds,
}: {
  sql: string;
  /** Where unqualified view names resolve. */
  database: string;
  views: readonly LangWatchQLViewDefinition[];
  traceIds: string;
}): LangWatchQLTraceIdsCut {
  const asWritten = { sql, twin: undefined };
  const twinned = new Set(
    views
      .filter(hasTraceIdsTwin)
      .map((view) => qualifyTableName({ table: view.name, defaultDatabase: database })),
  );
  const parsed = twinned.size === 0 ? undefined : clickHouseSqlParser.parse(sql);
  if (!parsed?.ok) return asWritten;
  const { statements } = parsed;
  const selects = topSelects(statements);
  const [select] = selects;
  if (statements.length !== 1 || selects.length !== 1 || !select) return asWritten;
  const [read] = twinnableReads({ statements, select, database, twinned });
  if (!read || !cutKeepsRows({ statements, select, read })) return asWritten;
  return withTwin({ sql, read, traceIds });
}

/** The sentences ClickHouse names a missing or ungranted relation in, each capturing it. */
const REFUSED_RELATION_PATTERNS: readonly RegExp[] = [
  /Unknown table function [`'"]?([\w.`]+)/,
  /Unknown table expression identifier [`'"]?([\w.`]+)/,
  /Table [`'"]?([\w.`]+?)[`'"]? does(?:n't| not) exist/,
  /grant .*? ON [`'"]?([\w.`]+)/s,
];

/**
 * Whether a ClickHouse refusal names `twin` (`database.name`) as the relation it lacks or may not
 * read: compared whole, qualified or bare, and read before any echo of the query (`in scope`).
 */
export function refusalNamesTwin({ message, twin }: { message: string; twin: string }): boolean {
  const [head = ""] = message.split(/\bin scope\b/i);
  const expected = twin.toLowerCase();
  const bare = expected.slice(expected.indexOf(".") + 1);
  return REFUSED_RELATION_PATTERNS.some((pattern) => {
    const named = pattern.exec(head)?.[1]?.replace(/[`'"]/g, "").replace(/\.+$/, "").toLowerCase();
    if (named === undefined) return false;
    return named.includes(".") ? named === expected : named === bare;
  });
}
