/**
 * LWQL compiler — IR to ClickHouse SQL.
 *
 * Three invariants hold on every path out of this file, and they are the whole
 * security story (issue #6346 decisions 2 and 3):
 *
 *   1. Every identifier in the emitted SQL comes from `catalog.ts`. Nothing
 *      derived from caller input is ever concatenated into an identifier
 *      position — a field name *selects* an expression, it never becomes one.
 *   2. Every caller-supplied value is bound as a query parameter.
 *   3. The tenant predicate is appended by this compiler from the
 *      RBAC-checked `projectId` argument. It is not read from the IR, cannot be
 *      widened by any query text, and is ANDed at the top level so no `OR`
 *      inside the caller's predicate can escape it.
 */

import {
  AGGREGATION_NAMES,
  AGGREGATIONS,
  AGGREGATIONS_ALLOWING_STAR,
  ENTITY_NAMES,
  fieldNames,
  getEntity,
  getField,
  type LwqlEntityDef,
  type LwqlFieldDef,
  NUMERIC_ONLY_AGGREGATIONS,
} from "./catalog";
import { closestMatch, LwqlError, unknownFieldError } from "./errors";
import { assertFieldAllowed, type GatingContext } from "./gating";
import {
  DEFAULT_LIMIT,
  DEFAULT_TIME_RANGE_DAYS,
  type LwqlComparison,
  type LwqlLiteral,
  type LwqlOrderBy,
  type LwqlPredicate,
  type LwqlQuery,
  type LwqlSelectItem,
  MAX_LIMIT,
  MAX_PREDICATE_DEPTH,
  MAX_TIME_RANGE_DAYS,
  normaliseWhere,
} from "./ir";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats an instant the way ClickHouse parses `DateTime64(3)`:
 * `YYYY-MM-DD HH:MM:SS.mmm`, no `T`, no trailing `Z`.
 *
 * ISO-8601 is rejected outright — ClickHouse reports "only 23 of 24 bytes was
 * parsed" and the whole query fails. Since every LWQL query carries a time
 * bound, getting this wrong breaks every query, and no amount of asserting on
 * the generated SQL string reveals it.
 */
const toClickHouseDateTime = (epochMs: number): string =>
  new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");

export interface CompileOptions {
  /** RBAC-checked tenant scope. The only source of tenant identity. */
  projectId: string;
  gating: GatingContext;
  /** Injected for deterministic tests; defaults to wall clock. */
  now?: number;
}

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
  /** Result column names, in order, for the normalised response shape. */
  columns: string[];
  /** Effective row cap, after clamping. */
  limit: number;
}

interface Ctx {
  entity: LwqlEntityDef;
  entityName: string;
  params: Record<string, unknown>;
  paramCounter: number;
  gating: GatingContext;
}

const clickhouseType = (field: LwqlFieldDef): string => {
  switch (field.type) {
    case "number":
      return "Float64";
    case "bool":
      return "Bool";
    case "timestamp":
      return "DateTime64(3)";
    case "string":
    default:
      return "String";
  }
};

/** Binds a value and returns its placeholder. Values never reach SQL directly. */
const bind = (ctx: Ctx, value: unknown, type: string): string => {
  const name = `p${ctx.paramCounter++}`;
  ctx.params[name] = value;
  return `{${name}:${type}}`;
};

const resolveField = (
  ctx: Ctx,
  name: string,
  usage: "select" | "filter" | "group_by" | "order_by",
): LwqlFieldDef => {
  const field = getField(ctx.entity, name);
  if (!field) {
    throw unknownFieldError(name, ctx.entityName, fieldNames(ctx.entity));
  }
  assertFieldAllowed({
    entity: ctx.entity,
    fieldName: name,
    usage,
    ctx: ctx.gating,
  });
  return field;
};

const typeMismatch = ({
  fieldName,
  expected,
  actual,
  hint,
}: {
  fieldName: string;
  expected: string;
  actual: string;
  hint: string;
}): LwqlError =>
  new LwqlError(
    "type_mismatch",
    `Field '${fieldName}' is ${expected} but was compared to ${actual}.`,
    { hint },
  );

/** Accepts epoch milliseconds or an ISO-8601 string, emitting ClickHouse's form. */
const coerceTimestamp = (fieldName: string, value: LwqlLiteral): unknown => {
  if (typeof value === "number") return toClickHouseDateTime(value);

  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) {
    throw new LwqlError(
      "type_mismatch",
      `Field '${fieldName}' expects a timestamp but '${String(value)}' could not be parsed.`,
      { hint: "Use an ISO-8601 timestamp or epoch milliseconds." },
    );
  }
  return toClickHouseDateTime(parsed);
};

/** Coerces a literal to the field's domain, rejecting mismatches loudly. */
const coerce = (
  field: LwqlFieldDef,
  fieldName: string,
  value: LwqlLiteral,
): unknown => {
  if (value === null) return null;

  switch (field.type) {
    case "number":
      if (typeof value !== "number") {
        throw typeMismatch({
          fieldName,
          expected: "numeric",
          actual: typeof value,
          hint: `Write a bare number, e.g. ${fieldName} > 100.`,
        });
      }
      return value;
    case "bool":
      if (typeof value !== "boolean") {
        throw typeMismatch({
          fieldName,
          expected: "boolean",
          actual: typeof value,
          hint: `Use true or false, e.g. ${fieldName} = true.`,
        });
      }
      return value;
    case "timestamp":
      return coerceTimestamp(fieldName, value);
    default:
      if (typeof value !== "string") {
        throw typeMismatch({
          fieldName,
          expected: "a string",
          actual: typeof value,
          hint: `Quote the value, e.g. ${fieldName} = 'example'.`,
        });
      }
      return value;
  }
};

const isComparison = (node: LwqlPredicate): node is LwqlComparison =>
  typeof node === "object" && node !== null && "field" in node;

/** Everything a comparison compiler needs about the field it is comparing. */
interface FilterTarget {
  field: LwqlFieldDef;
  expr: string;
  chType: string;
  isArray: boolean;
}

const compileInPredicate = (
  ctx: Ctx,
  node: LwqlComparison,
  target: FilterTarget,
): string => {
  if (!Array.isArray(node.value)) {
    throw new LwqlError(
      "invalid_query",
      `Operator '${node.op}' on '${node.field}' expects a list of values.`,
      { hint: `Write ${node.field} IN ('a', 'b').` },
    );
  }

  const values = node.value.map((v) => coerce(target.field, node.field, v));
  const placeholder = bind(ctx, values, `Array(${target.chType})`);
  const positive = target.isArray
    ? `hasAny(${target.expr}, ${placeholder})`
    : `${target.expr} IN ${placeholder}`;
  return node.op === "in" ? positive : `(NOT ${positive})`;
};

const compileLikePredicate = (
  ctx: Ctx,
  node: LwqlComparison,
  target: FilterTarget,
): string => {
  if (target.field.type !== "string") {
    throw new LwqlError(
      "type_mismatch",
      `LIKE is only valid on string fields; '${node.field}' is ${target.field.type}.`,
      { hint: `Use a comparison operator instead, e.g. ${node.field} > 0.` },
    );
  }
  if (typeof node.value !== "string") {
    throw new LwqlError(
      "invalid_query",
      `LIKE on '${node.field}' expects a string pattern.`,
      { hint: `Write ${node.field} LIKE '%text%'.` },
    );
  }

  const placeholder = bind(ctx, node.value, "String");
  // `arrayExists` keeps LIKE meaningful on an array column without the
  // row-multiplying effect of arrayJoin.
  const positive = target.isArray
    ? `arrayExists(x -> x LIKE ${placeholder}, ${target.expr})`
    : `${target.expr} LIKE ${placeholder}`;
  return node.op === "like" ? positive : `(NOT ${positive})`;
};

const compileBinaryPredicate = (
  ctx: Ctx,
  node: LwqlComparison,
  target: FilterTarget,
): string => {
  if (node.value === undefined || Array.isArray(node.value)) {
    throw new LwqlError(
      "invalid_query",
      `Operator '${node.op}' on '${node.field}' expects a single value.`,
    );
  }

  const value = coerce(target.field, node.field, node.value);
  const placeholder = bind(ctx, value, target.chType);

  if (target.isArray) {
    if (node.op === "=") return `has(${target.expr}, ${placeholder})`;
    if (node.op === "!=") return `(NOT has(${target.expr}, ${placeholder}))`;
    throw new LwqlError(
      "invalid_query",
      `Operator '${node.op}' is not supported on '${node.field}'.`,
      { hint: `'${node.field}' supports =, !=, IN and LIKE.` },
    );
  }

  // `node.op` is one of the closed enum members validated by the IR schema, so
  // this is an allowlisted operator, not caller text.
  return `${target.expr} ${node.op} ${placeholder}`;
};

const compileComparison = (ctx: Ctx, node: LwqlComparison): string => {
  const field = resolveField(ctx, node.field, "filter");
  const target: FilterTarget = {
    field,
    expr: field.filterExpr ?? field.selectExpr,
    chType: clickhouseType(field),
    isArray: field.filterKind === "array",
  };

  switch (node.op) {
    case "is_null":
      return target.isArray
        ? `empty(${target.expr})`
        : `${target.expr} IS NULL`;
    case "is_not_null":
      return target.isArray
        ? `notEmpty(${target.expr})`
        : `${target.expr} IS NOT NULL`;
    case "in":
    case "not_in":
      return compileInPredicate(ctx, node, target);
    case "like":
    case "not_like":
      return compileLikePredicate(ctx, node, target);
    default:
      return compileBinaryPredicate(ctx, node, target);
  }
};

const compilePredicate = (
  ctx: Ctx,
  node: LwqlPredicate,
  depth: number,
): string => {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw new LwqlError("invalid_query", "Query is nested too deeply.", {
      hint: `Flatten the WHERE clause to at most ${MAX_PREDICATE_DEPTH} levels.`,
    });
  }

  const compileChild = (child: LwqlPredicate) =>
    compilePredicate(ctx, child, depth + 1);

  if ("and" in node) return `(${node.and.map(compileChild).join(" AND ")})`;
  if ("or" in node) return `(${node.or.map(compileChild).join(" OR ")})`;
  if ("not" in node) return `(NOT ${compileChild(node.not)})`;

  if (!isComparison(node)) {
    throw new LwqlError("invalid_query", "Unrecognised condition in WHERE.");
  }
  return compileComparison(ctx, node);
};

interface ResolvedSelect {
  sql: string;
  alias: string;
  isAggregate: boolean;
  /** Bare field name when unaggregated, for the GROUP BY completeness check. */
  fieldName?: string;
}

/** Rejects a function name outside the closed aggregate set. */
const assertKnownAggregate = (item: LwqlSelectItem): void => {
  if (AGGREGATION_NAMES.includes(item.fn as never)) return;

  // Match on the normalised name; report the author's spelling.
  const suggestion = closestMatch(item.fn!, AGGREGATION_NAMES);
  const shown = item.fnRaw ?? item.fn;
  throw new LwqlError("unknown_function", `Unknown function '${shown}'.`, {
    hint: suggestion
      ? `Did you mean '${suggestion}'?`
      : `Available functions: ${AGGREGATION_NAMES.join(", ")}.`,
  });
};

const resolveAggregateItem = (
  ctx: Ctx,
  item: LwqlSelectItem,
  alias: string,
): ResolvedSelect => {
  assertKnownAggregate(item);
  const fnName = item.fn!;

  if (item.field === "*") {
    if (!AGGREGATIONS_ALLOWING_STAR.has(fnName)) {
      throw new LwqlError("invalid_query", `'${fnName}(*)' is not valid.`, {
        hint: `Only count(*) takes a wildcard; '${fnName}' needs a field.`,
      });
    }
    return {
      sql: `${AGGREGATIONS.count("*")} AS \`${alias}\``,
      alias,
      isAggregate: true,
    };
  }

  const field = resolveField(ctx, item.field, "select");
  if (NUMERIC_ONLY_AGGREGATIONS.has(fnName) && field.type !== "number") {
    throw new LwqlError(
      "type_mismatch",
      `'${fnName}' needs a numeric field; '${item.field}' is ${field.type}.`,
      { hint: `Try count(${item.field}) instead.` },
    );
  }

  const fn = AGGREGATIONS[fnName as keyof typeof AGGREGATIONS];
  return {
    sql: `${fn(field.selectExpr)} AS \`${alias}\``,
    alias,
    isAggregate: true,
  };
};

const resolveSelectItem = (ctx: Ctx, item: LwqlSelectItem): ResolvedSelect => {
  const alias =
    item.as ??
    (item.fn
      ? `${item.fn}_${item.field === "*" ? "all" : item.field}`
      : item.field);

  if (item.fn) return resolveAggregateItem(ctx, item, alias);

  if (item.field === "*") {
    throw new LwqlError("invalid_query", "SELECT * is not supported.", {
      hint: "List the fields you want, e.g. SELECT trace_id, duration_ms.",
    });
  }

  const field = resolveField(ctx, item.field, "select");
  return {
    sql: `${field.selectExpr} AS \`${alias}\``,
    alias,
    isAggregate: false,
    fieldName: item.field,
  };
};

interface OrderByContext {
  ctx: Ctx;
  selected: ResolvedSelect[];
  grouped: boolean;
  groupBy: string[];
}

const compileOrderTerm = (
  item: LwqlOrderBy,
  { ctx, selected, grouped, groupBy }: OrderByContext,
): string => {
  const direction = item.direction === "desc" ? "DESC" : "ASC";

  // Ordering by an output alias is the common case and costs no extra
  // resolution — it also lets `ORDER BY avg(cost_usd)` work without
  // re-deriving the expression.
  const aliasMatch = selected.find(
    (s) =>
      s.alias === item.field ||
      (item.fn && s.alias === `${item.fn}_${item.field}`),
  );
  if (aliasMatch) return `\`${aliasMatch.alias}\` ${direction}`;

  const field = resolveField(ctx, item.field, "order_by");

  if (item.fn) {
    const fn = AGGREGATIONS[item.fn as keyof typeof AGGREGATIONS];
    return `${fn(field.selectExpr)} ${direction}`;
  }

  // A bare field in ORDER BY is only legal in a grouped query if it is one of
  // the grouping keys. Without this, ClickHouse rejects the query itself ("not
  // under aggregate function and not in GROUP BY keys", code 215) and the
  // caller gets a database error instead of a message naming the fix.
  if (grouped && !groupBy.includes(item.field)) {
    throw new LwqlError(
      "invalid_query",
      `Cannot order by '${item.field}': it is neither grouped nor aggregated.`,
      {
        hint: "Add it to GROUP BY, order by an aggregate such as count(*), or order by a selected column.",
      },
    );
  }

  return `${field.selectExpr} ${direction}`;
};

const compileOrderBy = (
  orderBy: LwqlOrderBy[],
  context: OrderByContext,
): string => orderBy.map((item) => compileOrderTerm(item, context)).join(", ");

/**
 * Rejects grouped queries whose SELECT mixes aggregates with bare fields that
 * are not grouping keys. ClickHouse permits it and returns an arbitrary row's
 * value, which is almost always a bug.
 */
const assertGroupingIsComplete = (
  selected: ResolvedSelect[],
  groupBy: string[],
): void => {
  const hasAggregate = selected.some((s) => s.isAggregate);

  if (!hasAggregate) {
    if (groupBy.length > 0) {
      throw new LwqlError(
        "invalid_query",
        "GROUP BY requires at least one aggregate in SELECT.",
        { hint: "Add an aggregate such as count(*), or drop the GROUP BY." },
      );
    }
    return;
  }

  const ungrouped = selected
    .filter((s) => !s.isAggregate && s.fieldName)
    .map((s) => s.fieldName!)
    .filter((name) => !groupBy.includes(name));

  if (ungrouped.length > 0) {
    throw new LwqlError(
      "invalid_query",
      `Field(s) ${ungrouped.map((f) => `'${f}'`).join(", ")} must appear in GROUP BY or be aggregated.`,
      {
        hint: `Add GROUP BY ${ungrouped.join(", ")}, or wrap them in an aggregate such as count().`,
      },
    );
  }
};

/**
 * Resolves the effective window, defaulting and clamping it.
 *
 * An unbounded query over a large tenant is the easiest way to turn this
 * endpoint into an availability problem for everyone else, so a bound is always
 * present even when the caller supplies none.
 */
const resolveTimeRange = (
  query: LwqlQuery,
  now: number,
): { from: number; to: number } => {
  const requestedFrom = query.time_range?.from;
  const to = query.time_range?.to ?? now;
  const earliestAllowed = to - MAX_TIME_RANGE_DAYS * DAY_MS;

  if (requestedFrom !== undefined && requestedFrom < earliestAllowed) {
    throw new LwqlError(
      "limit_exceeded",
      `Time range exceeds the ${MAX_TIME_RANGE_DAYS}-day maximum.`,
      { hint: `Narrow the range to ${MAX_TIME_RANGE_DAYS} days or fewer.` },
    );
  }

  const from = Math.max(
    requestedFrom ?? now - DEFAULT_TIME_RANGE_DAYS * DAY_MS,
    earliestAllowed,
  );
  if (from > to) {
    throw new LwqlError("invalid_query", "Time range starts after it ends.");
  }

  return { from, to };
};

const resolveEntity = (name: string): LwqlEntityDef => {
  const entity = getEntity(name);
  if (entity) return entity;

  const suggestion = closestMatch(name, ENTITY_NAMES);
  throw new LwqlError("unknown_entity", `Unknown entity '${name}'.`, {
    hint: suggestion
      ? `Did you mean '${suggestion}'?`
      : `Available entities: ${ENTITY_NAMES.join(", ")}.`,
  });
};

/**
 * Builds the WHERE clause.
 *
 * Tenant and time are ANDed at the TOP level, ahead of the caller's predicate,
 * so no `OR` the caller writes can widen past them.
 */
const buildWhere = (
  ctx: Ctx,
  query: LwqlQuery,
  options: CompileOptions,
): string => {
  const { entity } = ctx;

  // ---- tenant scope: injected here, never parsed ----
  const tenantPredicate = `${entity.tenantColumn} = ${bind(ctx, options.projectId, "String")}`;

  const { from, to } = resolveTimeRange(query, options.now ?? Date.now());
  const timePredicate =
    `${entity.timeColumn} >= ${bind(ctx, toClickHouseDateTime(from), "DateTime64(3)")}` +
    ` AND ${entity.timeColumn} <= ${bind(ctx, toClickHouseDateTime(to), "DateTime64(3)")}`;

  const userPredicate = normaliseWhere(query.where);
  const userSql = userPredicate
    ? compilePredicate(ctx, userPredicate, 0)
    : undefined;

  return [tenantPredicate, timePredicate, ...(userSql ? [userSql] : [])].join(
    " AND ",
  );
};

export const compile = (
  query: LwqlQuery,
  options: CompileOptions,
): CompiledQuery => {
  const entity = resolveEntity(query.from);

  const ctx: Ctx = {
    entity,
    entityName: query.from,
    params: {},
    paramCounter: 0,
    gating: options.gating,
  };

  const selected = query.select.map((item) => resolveSelectItem(ctx, item));
  const groupBy = query.group_by ?? [];
  const groupExprs = groupBy.map(
    (name) => resolveField(ctx, name, "group_by").selectExpr,
  );

  assertGroupingIsComplete(selected, groupBy);

  const where = buildWhere(ctx, query, options);
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = query.offset ?? 0;

  const parts = [
    `SELECT ${selected.map((s) => s.sql).join(", ")}`,
    `FROM ${entity.table}`,
    `WHERE ${where}`,
  ];

  if (groupExprs.length > 0) parts.push(`GROUP BY ${groupExprs.join(", ")}`);

  if (query.order_by && query.order_by.length > 0) {
    parts.push(
      `ORDER BY ${compileOrderBy(query.order_by, {
        ctx,
        selected,
        grouped: selected.some((s) => s.isAggregate),
        groupBy,
      })}`,
    );
  }

  // One extra row is fetched so the caller can be told the result was truncated
  // rather than silently receiving a full page.
  parts.push(`LIMIT ${limit + 1}`);
  if (offset > 0) parts.push(`OFFSET ${offset}`);

  return {
    sql: parts.join("\n"),
    params: ctx.params,
    columns: selected.map((s) => s.alias),
    limit,
  };
};
