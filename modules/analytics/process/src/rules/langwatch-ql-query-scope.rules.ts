import {
  formatLangWatchQLDateTimeParameter,
  type LangWatchQLCaller,
  type LangWatchQLMemberWindow,
  type LangWatchQLProtections,
  type LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import { DEFAULT_TRACE_ORIGIN } from "@langwatch/trace-contract";

import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import { clickHouseSqlParser, type SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import { qualifyTableName } from "./langwatch-ql-policy.rules.ts";
import { clickHouseLiteral } from "./langwatch-ql-sql-literal.rules.ts";
import { METADATA_FIELDS } from "./langwatch-ql-validation-shape.rules.ts";

/**
 * The strictest protections across a readable project set: a content category or a catalogue
 * permission is offered only when every project in the set grants it; an empty set offers nothing.
 * @see specs/lwql/api.feature — the query door redacts to the strictest protection
 */
export function strictestLangWatchQLProtections(
  perProject: readonly LangWatchQLProtections[],
): LangWatchQLProtections {
  type Category = "canSeeCosts" | "canSeeCapturedInput" | "canSeeCapturedOutput";
  const everyProjectGrants = (category: Category): boolean =>
    perProject.length > 0 && perProject.every((protections) => protections[category] === true);
  const [first, ...rest] = perProject;
  const permissions = (first?.catalogue.permissions ?? []).filter((permission) =>
    rest.every((protections) => protections.catalogue.permissions.includes(permission)),
  );

  return {
    canSeeCosts: everyProjectGrants("canSeeCosts"),
    canSeeCapturedInput: everyProjectGrants("canSeeCapturedInput"),
    canSeeCapturedOutput: everyProjectGrants("canSeeCapturedOutput"),
    catalogue: { permissions },
  };
}

const ORIGIN_COLUMN = "Origin";
const TRACE_ID_COLUMN = "TraceId";

/**
 * The one-row-per-trace view that knows each trace's origin. A view that only names a trace is
 * scoped through it, because spans, evaluations and the rest carry no origin of their own.
 */
const TRACE_ORIGIN_VIEW = "trace_metrics";

/** An unstamped origin is the application's, exactly as `deriveTraceOrigin` reads it. */
const traceOriginOf = (column: string) =>
  `ifNull(nullIf(${column}, ''), ${clickHouseLiteral(DEFAULT_TRACE_ORIGIN)})`;

/**
 * Earliest `OccurredAt` of a trace owning a row in `window`: one window back for a comparison
 * with the period before, plus the day of slack catalogue lookups give a trace observed after its
 * first span started. `OccurredAt` leads the sort key, so it prunes (analytics ADR-003).
 */
function traceLookupStart(window: LangWatchQLTimeWindow): string {
  const at = (instant: string) =>
    `toDateTime(${clickHouseLiteral(formatLangWatchQLDateTimeParameter(instant))}, 'UTC')`;
  const start = at(window.start);
  return `subtractDays(subtractSeconds(${start}, dateDiff('second', ${start}, ${at(window.end)})), 1)`;
}

/** One view the statement names, where it is written, and the name its rows go by. */
interface ViewReference {
  /** `database.view`, lowercased, as the catalogue is keyed. */
  readonly qualified: string;
  /** The alias an unaliased reference needs, so `traces.TraceId` still resolves. */
  readonly impliedAlias?: string;
  readonly start: number;
  readonly end: number;
}

/** Every node of `type` under `value`, skipping the fields that say nothing about the query. */
function collectNodes(value: unknown, type: string, found: SqlAstNode[]): SqlAstNode[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, type, found);
    return found;
  }
  if (typeof value !== "object" || value === null) return found;
  const node = value as SqlAstNode;
  if (node.type === type) found.push(node);
  for (const [field, child] of Object.entries(node)) {
    if (!METADATA_FIELDS.includes(field)) collectNodes(child, type, found);
  }
  return found;
}

/** The view references in a parsed statement, last first, each once; `WITH` names are not views. */
function findViewReferences({
  statements,
  database,
}: {
  statements: readonly SqlAstNode[];
  database: string;
}): ViewReference[] {
  const cteNames = new Set(
    collectNodes(statements, "WithElement", []).flatMap(({ name }) =>
      typeof name === "string" ? [name.trim().toLowerCase()] : [],
    ),
  );
  // By position, because the tree reaches a `WITH` body from more than one field.
  const byStart = new Map<number, ViewReference>();
  for (const node of collectNodes(statements, "TableIdentifier", [])) {
    const { name, database: written, alias } = node;
    const { start, end } =
      (node as { location?: { start?: { offset?: unknown }; end?: { offset?: unknown } } })
        .location ?? {};
    if (typeof name !== "string" || typeof start?.offset !== "number") continue;
    if (typeof end?.offset !== "number") continue;
    const qualifier = typeof written === "string" ? written : undefined;
    const bareName = name.trim().toLowerCase();
    if (!qualifier && cteNames.has(bareName)) continue;
    byStart.set(start.offset, {
      qualified: qualifyTableName({ table: name, database: qualifier, defaultDatabase: database }),
      ...(typeof alias === "string" ? {} : { impliedAlias: name }),
      start: start.offset,
      end: end.offset,
    });
  }
  return [...byStart.values()].toSorted((left, right) => right.start - left.start);
}

/**
 * The predicate keeping each view's rows to the origins not left out, keyed like a reference.
 * A view with no `Origin` and no `TraceId`, such as a per-minute rollup, gets none.
 */
function buildOriginPredicates({
  views,
  database,
  excludeOrigins,
  timeWindow,
}: {
  views: readonly LangWatchQLViewDefinition[];
  database: string;
  excludeOrigins: readonly string[];
  timeWindow?: LangWatchQLTimeWindow;
}): ReadonlyMap<string, string> {
  const excluded = excludeOrigins.map(clickHouseLiteral).join(", ");
  const traceOriginView = qualifyTableName({ table: TRACE_ORIGIN_VIEW, defaultDatabase: database });
  const canReachTraceOrigin = views.some(
    (view) => qualifyTableName({ table: view.name, defaultDatabase: database }) === traceOriginView,
  );
  // `ifNull` because `NULL NOT IN (…)` is NULL, which would drop a row that belongs to no trace.
  const byTrace =
    `ifNull(${TRACE_ID_COLUMN}, '') NOT IN (SELECT ${TRACE_ID_COLUMN} ` +
    `FROM ${database}.${TRACE_ORIGIN_VIEW} ` +
    `WHERE ${traceOriginOf(ORIGIN_COLUMN)} IN (${excluded})` +
    (timeWindow ? ` AND OccurredAt >= ${traceLookupStart(timeWindow)}` : "") +
    ")";
  const byOrigin = `${traceOriginOf(ORIGIN_COLUMN)} NOT IN (${excluded})`;

  const predicates = new Map<string, string>();
  for (const view of views) {
    const columns = new Set(view.columns.map((column) => column.name));
    const key = qualifyTableName({ table: view.name, defaultDatabase: database });
    if (columns.has(ORIGIN_COLUMN)) predicates.set(key, byOrigin);
    else if (columns.has(TRACE_ID_COLUMN) && canReachTraceOrigin) predicates.set(key, byTrace);
  }
  return predicates;
}

const TENANT_COLUMN = "TenantId";

/** Admits no row: a view the windows cannot be applied to reads nothing on an aggregate. */
const NO_ROWS = "0";

/**
 * The predicate keeping each view's rows to the members inside their windows, keyed like a
 * reference. The row policy already bounds the tenants; this bounds when each is read from. A
 * view without the window's time column keeps only the members shared for their whole history.
 */
function buildWindowPredicates({
  views,
  database,
  memberWindows,
}: {
  views: readonly LangWatchQLViewDefinition[];
  database: string;
  memberWindows: readonly LangWatchQLMemberWindow[];
}): ReadonlyMap<string, string> {
  const whole = memberWindows.filter((window) => window.from <= 0);
  const dated = memberWindows.filter((window) => window.from > 0);
  const wholeClause =
    whole.length === 0
      ? undefined
      : `${TENANT_COLUMN} IN (${whole.map((window) => clickHouseLiteral(window.projectId)).join(", ")})`;

  const predicates = new Map<string, string>();
  for (const view of views) {
    const columns = new Set(view.columns.map((column) => column.name));
    const key = qualifyTableName({ table: view.name, defaultDatabase: database });
    if (!columns.has(TENANT_COLUMN)) {
      predicates.set(key, NO_ROWS);
      continue;
    }
    const timeColumn =
      view.timeColumn !== undefined && columns.has(view.timeColumn) ? view.timeColumn : undefined;
    const picks = [
      ...(wholeClause === undefined ? [] : [wholeClause]),
      ...(timeColumn === undefined
        ? []
        : dated.map(
            (window) =>
              `(${TENANT_COLUMN} = ${clickHouseLiteral(window.projectId)} AND ` +
              `${timeColumn} >= fromUnixTimestamp64Milli(toInt64(${Math.trunc(window.from)})))`,
          )),
    ];
    predicates.set(key, picks.length === 0 ? NO_ROWS : `(${picks.join(" OR ")})`);
  }
  return predicates;
}

/**
 * `sql`, an accepted statement, with every catalogued view it reads replaced by that view minus
 * the `excludeOrigins` traces: a board shows the member's agent, not Langy's turns (ADR-061).
 * Scoping each reference keeps a widget's own Origin filter meaningful (analytics ADR-003).
 *
 * With `memberWindows`, an aggregate's run, each reference is also kept to the members inside
 * their grants' windows, and a reference to a view outside `views` reads nothing (ADR-177 v4.14).
 */
export function scopeLangWatchQL({
  sql,
  excludeOrigins,
  database,
  views,
  timeWindow,
  memberWindows,
}: {
  sql: string;
  excludeOrigins: readonly string[];
  /** Where unqualified view names resolve. */
  database: string;
  views: readonly LangWatchQLViewDefinition[];
  /** The period the statement is bound to; absent, the trace lookup reads all history. */
  timeWindow?: LangWatchQLTimeWindow;
  /** The members an aggregate reads and where each window opens; absent on a plain project. */
  memberWindows?: readonly LangWatchQLMemberWindow[];
}): string {
  // Whole-history members need no rewrite: the row policy bounds them exactly.
  const isWindowed = memberWindows?.some((window) => window.from > 0) === true;
  if (excludeOrigins.length === 0 && !isWindowed) return sql;

  const parsed = clickHouseSqlParser.parse(sql);
  if (!parsed.ok) {
    throw new Error("LangWatchQL scope: an accepted statement no longer parses");
  }

  const origins =
    excludeOrigins.length === 0
      ? new Map<string, string>()
      : buildOriginPredicates({
          views,
          database,
          excludeOrigins,
          ...(timeWindow ? { timeWindow } : {}),
        });
  const windows =
    isWindowed && memberWindows
      ? buildWindowPredicates({ views, database, memberWindows })
      : undefined;
  let scoped = sql;
  for (const reference of findViewReferences({ statements: parsed.statements, database })) {
    const window =
      windows === undefined ? undefined : (windows.get(reference.qualified) ?? NO_ROWS);
    const predicate = [origins.get(reference.qualified), window]
      .filter((part) => part !== undefined)
      .join(" AND ");
    if (predicate === "") continue;
    const written = sql.slice(reference.start, reference.end);
    const alias = reference.impliedAlias === undefined ? "" : ` AS ${reference.impliedAlias}`;
    scoped =
      `${scoped.slice(0, reference.start)}(SELECT * FROM ${written} WHERE ${predicate})${alias}` +
      scoped.slice(reference.end);
  }
  return scoped;
}

/**
 * The projects an app function may read text from. Its key is a value in the result, which a
 * statement can write as a literal, and the text read takes no date: so on an aggregate only
 * members shared for their whole history are read, and a dated member's text stays unresolved.
 */
export function hydratableProjects({
  projects,
  memberWindows,
}: {
  projects: readonly LangWatchQLCaller[];
  memberWindows: readonly LangWatchQLMemberWindow[] | undefined;
}): readonly LangWatchQLCaller[] {
  if (memberWindows === undefined) return projects;
  const whole = new Set(
    memberWindows.filter((window) => window.from <= 0).map((window) => window.projectId),
  );
  return projects.filter((project) => whole.has(project.id));
}
