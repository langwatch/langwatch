/**
 * LangWatchQL analytics SQL — sending a read bounded below on a view's floor column to the view's
 * floored twin, whose dedup reads only the versions from that bound (analytics ADR-005).
 * @see specs/lwql/dedup-floor.feature
 */
import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import { clickHouseSqlParser, type SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import { qualifyTableName } from "./langwatch-ql-policy.rules.ts";
import { METADATA_FIELDS } from "./langwatch-ql-validation-shape.rules.ts";

/** The parameter a floored view takes its lower bound in. */
export const LWQL_FLOOR_PARAMETER = "lwql_floor";

const FLOOR_SUFFIX = "__floor";

/** The floored twin of a view: provisioned beside it, read only through this rewrite. */
export function flooredViewName(view: string): string {
  return `${view}${FLOOR_SUFFIX}`;
}

/** The view a floored twin is cut from (whose columns it carries), else `relation` itself. */
export function baseViewName(relation: string): string {
  return relation.endsWith(FLOOR_SUFFIX) ? relation.slice(0, -FLOOR_SUFFIX.length) : relation;
}

/** The views whose twin is provisioned: in-tuple ones that declare a floor column. */
function floorableViews(
  views: readonly LangWatchQLViewDefinition[],
): { name: string; floorColumn: string }[] {
  return views.flatMap(({ name, dedup }) =>
    dedup.strategy === "in-tuple" && dedup.floorColumn !== undefined
      ? [{ name, floorColumn: dedup.floorColumn }]
      : [],
  );
}

/** The floored twins `views` provision: one per in-tuple view that declares a floor column. */
export function flooredViewNames(views: readonly LangWatchQLViewDefinition[]): string[] {
  return floorableViews(views).map(({ name }) => flooredViewName(name));
}

/** The joins that keep every row of every side they join, so a WHERE bound filters it first. */
const INNER_JOINS = ["INNER", "COMMA", "CROSS"];
/** The leftmost table of these keeps its own rows; only its matches change. */
const LEFT_PRESERVING_JOINS = [...INNER_JOINS, "LEFT"];
/** Which argument of a comparison is the column when the other is a lower bound on it. */
const LOWER_BOUND_COLUMN: Readonly<Record<string, 0 | 1>> = {
  greaterOrEquals: 0,
  greater: 0,
  lessOrEquals: 1,
  less: 1,
};
/**
 * The functions a bound may call: each is one value for the whole query, so the twin's argument
 * and the statement's own WHERE agree. Lower-cased; anything else keeps the whole-history dedup.
 */
const QUERY_CONSTANT_FUNCTIONS: ReadonlySet<string> = new Set([
  "now",
  "now64",
  "today",
  "yesterday",
  "todate",
  "todate32",
  "todatetime",
  "todatetime64",
  "cast",
  "plus",
  "minus",
  "multiply",
  "intdiv",
  "datediff",
  "fromunixtimestamp",
  "fromunixtimestamp64milli",
  ...["second", "minute", "hour", "day", "week", "month", "quarter", "year"].flatMap((unit) => [
    `tointerval${unit}`,
    `add${unit}s`,
    `subtract${unit}s`,
  ]),
  ...["minute", "hour", "day", "week", "month"].map((unit) => `tostartof${unit}`),
  "tostartofinterval",
]);

type Span = { readonly start: number; readonly end: number };
type FloorableView = { readonly name: string; readonly floorColumn: string };
type Replacement = Span & { readonly text: string };
/** What every SELECT of one statement is checked against. */
type StatementFacts = {
  readonly sql: string;
  readonly database: string;
  readonly floorable: ReadonlyMap<string, FloorableView>;
  readonly withNames: ReadonlySet<string>;
  readonly aliases: ReadonlySet<string>;
};

/** `value` as a tree node, in a list of none or one. */
function nodesOf(value: unknown): SqlAstNode[] {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as SqlAstNode).type === "string"
    ? [value as SqlAstNode]
    : [];
}

/** Where a node sits in the statement; every node the parser returns carries it. */
function getSpan(node: SqlAstNode): Span {
  const { start, end } =
    (node.location as { start?: { offset?: unknown }; end?: { offset?: unknown } } | undefined) ??
    {};
  if (typeof start?.offset !== "number" || typeof end?.offset !== "number") {
    throw new Error(`LangWatchQL dedup floor: a ${node.type} node carries no location`);
  }
  return { start: start.offset, end: end.offset };
}

/** Every node under `value` that `keep` accepts, skipping the fields that say nothing. */
function collectNodes(value: unknown, keep: (node: SqlAstNode) => boolean): SqlAstNode[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectNodes(item, keep));
  return nodesOf(value).flatMap((node) => [
    ...(keep(node) ? [node] : []),
    ...Object.entries(node)
      .filter(([field]) => !METADATA_FIELDS.includes(field))
      .flatMap(([, child]) => collectNodes(child, keep)),
  ]);
}

function conjuncts(value: unknown): SqlAstNode[] {
  return nodesOf(value).flatMap((node) =>
    node.type === "Function" && node.name === "and" && Array.isArray(node.arguments)
      ? node.arguments.flatMap(conjuncts)
      : [node],
  );
}

/** A non-NULL literal, a query parameter, or an allowed function of those: no column, no query. */
function isQueryConstant(node: SqlAstNode): boolean {
  if (node.type === "Literal") return node.value_type !== "Null";
  if (node.type === "QueryParameter") return true;
  if (node.type !== "Function" || typeof node.name !== "string") return false;
  if (!QUERY_CONSTANT_FUNCTIONS.has(node.name.toLowerCase())) return false;
  const args = [
    ...(Array.isArray(node.arguments) ? node.arguments : []),
    ...(Array.isArray(node.parameters) ? node.parameters : []),
  ];
  return args.every((argument) => nodesOf(argument).some(isQueryConstant));
}

/** The bound of a `column >= bound` conjunct (either way round) on the column `isColumn` names. */
function lowerBoundsOf({
  conjunct,
  isColumn,
}: {
  conjunct: SqlAstNode;
  isColumn: (identifier: SqlAstNode) => boolean;
}): SqlAstNode[] {
  const side = typeof conjunct.name === "string" ? LOWER_BOUND_COLUMN[conjunct.name] : undefined;
  if (conjunct.type !== "Function" || side === undefined || !Array.isArray(conjunct.arguments)) {
    return [];
  }
  const columns = nodesOf(conjunct.arguments[side]);
  const isOnColumn = columns.some((node) => node.type === "Identifier" && isColumn(node));
  return isOnColumn ? nodesOf(conjunct.arguments[1 - side]).filter(isQueryConstant) : [];
}

/** Whether a WHERE bound on the table at `index` holds before the FROM joins it to the rest. */
function filtersBeforeJoin(elements: readonly SqlAstNode[], index: number): boolean {
  const kinds = elements
    .slice(1)
    .flatMap((element) => nodesOf(element.table_join))
    .map((join) => String(join.kind));
  if (kinds.every((kind) => INNER_JOINS.includes(kind))) return true;
  return index === 0 && kinds.every((kind) => LEFT_PRESERVING_JOINS.includes(kind));
}

/** Matches the floor column as `qualifier.column`, or bare when nothing else could own it. */
function floorColumnMatcher({
  view,
  qualifier,
  isOnlyTable,
  aliases,
}: {
  view: FloorableView;
  qualifier: string;
  isOnlyTable: boolean;
  aliases: ReadonlySet<string>;
}): (identifier: SqlAstNode) => boolean {
  const isBareAllowed = isOnlyTable && !aliases.has(view.floorColumn);
  return (identifier) => {
    const parts = Array.isArray(identifier.name_parts)
      ? (identifier.name_parts as string[])
      : [String(identifier.name)];
    if (parts.length === 2) return parts[0] === qualifier && parts[1] === view.floorColumn;
    return isBareAllowed && parts.length === 1 && parts[0] === view.floorColumn;
  };
}

/** The floored reference for the table at `index`, when the SELECT bounds its floor column. */
function replacementsFor({
  elements,
  index,
  bounds,
  facts,
}: {
  elements: readonly SqlAstNode[];
  index: number;
  bounds: readonly SqlAstNode[];
  facts: StatementFacts;
}): Replacement[] {
  const [table] = nodesOf(nodesOf(elements[index]?.table_expression)[0]?.database_and_table_name);
  if (table?.type !== "TableIdentifier" || typeof table.name !== "string") return [];
  const written = typeof table.database === "string" ? table.database : undefined;
  const alias = typeof table.alias === "string" ? table.alias : undefined;
  const qualified = qualifyTableName({
    table: table.name,
    database: written,
    defaultDatabase: facts.database,
  });
  const view = facts.floorable.get(qualified);
  if (!view || (written === undefined && facts.withNames.has(table.name.toLowerCase()))) return [];
  // A database-qualified name without an alias can be referenced as `db.view.column`,
  // which no alias of the floored call would still answer to.
  if (written !== undefined && alias === undefined) return [];
  if (!filtersBeforeJoin(elements, index)) return [];
  const qualifier = alias ?? table.name;
  // A SELECT alias of the same name would own `qualifier.column` instead of this table.
  if (facts.aliases.has(qualifier)) return [];

  const isColumn = floorColumnMatcher({
    view,
    qualifier,
    isOnlyTable: elements.length === 1,
    aliases: facts.aliases,
  });
  const [bound] = bounds.flatMap((conjunct) => lowerBoundsOf({ conjunct, isColumn }));
  const span = getSpan(table);
  const text = facts.sql.slice(span.start, span.end);
  if (!bound || !text.endsWith(table.name)) return [];

  const boundSpan = getSpan(bound);
  // The parameter is read as server-local time: a bound in another zone is moved into it first.
  const floor = `toTimeZone(toDateTime64((${facts.sql.slice(boundSpan.start, boundSpan.end)}), 3), timezone())`;
  const call =
    `${text.slice(0, text.length - table.name.length)}${flooredViewName(table.name)}` +
    `(${LWQL_FLOOR_PARAMETER} = ${floor})`;
  return [{ ...span, text: alias === undefined ? `${call} AS ${table.name}` : call }];
}

/** The floored references one SELECT's FROM gets. */
function replacementsIn({
  select,
  facts,
}: {
  select: SqlAstNode;
  facts: StatementFacts;
}): Replacement[] {
  const children = nodesOf(select.from)[0]?.children;
  const elements = Array.isArray(children) ? children.flatMap(nodesOf) : [];
  const bounds = conjuncts(select.where);
  return elements.flatMap((_, index) => replacementsFor({ elements, index, bounds, facts }));
}

/**
 * `sql` with each read of a floorable view that the same SELECT bounds below on the view's floor
 * column sent to its floored twin, from that bound. Any other read, and a statement that does not
 * parse, is sent as written. Run after the member-window scope, which reads the views by name.
 */
export function floorLangWatchQLDedup({
  sql,
  database,
  views,
}: {
  sql: string;
  /** Where unqualified view names resolve. */
  database: string;
  views: readonly LangWatchQLViewDefinition[];
}): string {
  const candidates = floorableViews(views);
  const lowered = sql.toLowerCase();
  const isNamed = candidates.some(({ name }) => lowered.includes(name.toLowerCase()));
  if (!isNamed) return sql;
  const parsed = clickHouseSqlParser.parse(sql);
  if (!parsed.ok) return sql;

  const { statements } = parsed;
  // A FROM source's alias names a table, which a column reference cannot be shadowed by.
  const tableSources = new Set(
    collectNodes(statements, (node) => node.type === "TableExpression").flatMap((source) =>
      Object.values(source).flatMap(nodesOf),
    ),
  );
  const facts: StatementFacts = {
    sql,
    database,
    floorable: new Map(
      candidates.map((view) => [
        qualifyTableName({ table: view.name, defaultDatabase: database }),
        view,
      ]),
    ),
    withNames: new Set(
      collectNodes(statements, (node) => node.type === "WithElement").flatMap(({ name }) =>
        typeof name === "string" ? [name.trim().toLowerCase()] : [],
      ),
    ),
    aliases: new Set(
      collectNodes(
        statements,
        (node) =>
          typeof node.alias === "string" &&
          node.type !== "TableIdentifier" &&
          !tableSources.has(node),
      ).map(({ alias }) => String(alias)),
    ),
  };
  // By position, because the tree reaches a `WITH` body from more than one field.
  const byStart = new Map<number, Replacement>();
  for (const select of collectNodes(statements, (node) => node.type === "SelectQuery")) {
    for (const replacement of replacementsIn({ select, facts })) {
      byStart.set(replacement.start, replacement);
    }
  }
  return [...byStart.values()]
    .toSorted((left, right) => right.start - left.start)
    .reduce(
      (text, { start, end, text: replacement }) =>
        `${text.slice(0, start)}${replacement}${text.slice(end)}`,
      sql,
    );
}
