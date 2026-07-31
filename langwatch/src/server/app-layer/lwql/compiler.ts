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
  AGGREGATIONS,
  AGGREGATION_NAMES,
  AGGREGATIONS_ALLOWING_STAR,
  NUMERIC_ONLY_AGGREGATIONS,
  ENTITY_NAMES,
  fieldNames,
  getEntity,
  getField,
  type LwqlEntityDef,
  type LwqlFieldDef,
} from "./catalog";
import { LwqlError, closestMatch, unknownFieldError } from "./errors";
import { assertFieldAllowed, type GatingContext } from "./gating";
import {
  DEFAULT_LIMIT,
  DEFAULT_TIME_RANGE_DAYS,
  MAX_LIMIT,
  MAX_PREDICATE_DEPTH,
  MAX_TIME_RANGE_DAYS,
  normaliseWhere,
  type LwqlLiteral,
  type LwqlOrderBy,
  type LwqlPredicate,
  type LwqlQuery,
  type LwqlSelectItem,
} from "./ir";

const DAY_MS = 24 * 60 * 60 * 1000;

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
        throw new LwqlError(
          "type_mismatch",
          `Field '${fieldName}' is numeric but was compared to ${typeof value}.`,
          { hint: `Write a bare number, e.g. ${fieldName} > 100.` },
        );
      }
      return value;
    case "bool":
      if (typeof value !== "boolean") {
        throw new LwqlError(
          "type_mismatch",
          `Field '${fieldName}' is boolean but was compared to ${typeof value}.`,
          { hint: `Use true or false, e.g. ${fieldName} = true.` },
        );
      }
      return value;
    case "timestamp":
      if (typeof value === "number") return new Date(value).toISOString();
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isNaN(parsed)) {
          throw new LwqlError(
            "type_mismatch",
            `Field '${fieldName}' expects a timestamp but '${value}' could not be parsed.`,
            { hint: "Use an ISO-8601 timestamp or epoch milliseconds." },
          );
        }
        return new Date(parsed).toISOString();
      }
      throw new LwqlError(
        "type_mismatch",
        `Field '${fieldName}' expects a timestamp.`,
        { hint: "Use an ISO-8601 timestamp or epoch milliseconds." },
      );
    case "string":
    default:
      if (typeof value !== "string") {
        throw new LwqlError(
          "type_mismatch",
          `Field '${fieldName}' is a string but was compared to ${typeof value}.`,
          { hint: `Quote the value, e.g. ${fieldName} = 'example'.` },
        );
      }
      return value;
  }
};

const isComparison = (
  node: LwqlPredicate,
): node is { field: string; op: string; value?: LwqlLiteral | LwqlLiteral[] } =>
  typeof node === "object" && node !== null && "field" in node;

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

  if ("and" in node) {
    return `(${node.and.map((n) => compilePredicate(ctx, n, depth + 1)).join(" AND ")})`;
  }
  if ("or" in node) {
    return `(${node.or.map((n) => compilePredicate(ctx, n, depth + 1)).join(" OR ")})`;
  }
  if ("not" in node) {
    return `(NOT ${compilePredicate(ctx, node.not, depth + 1)})`;
  }
  if (!isComparison(node)) {
    throw new LwqlError("invalid_query", "Unrecognised condition in WHERE.");
  }

  const field = resolveField(ctx, node.field, "filter");
  const expr = field.filterExpr ?? field.selectExpr;
  const chType = clickhouseType(field);
  const isArrayColumn = field.filterKind === "array";

  switch (node.op) {
    case "is_null":
      return isArrayColumn ? `empty(${expr})` : `${expr} IS NULL`;
    case "is_not_null":
      return isArrayColumn ? `notEmpty(${expr})` : `${expr} IS NOT NULL`;

    case "in":
    case "not_in": {
      if (!Array.isArray(node.value)) {
        throw new LwqlError(
          "invalid_query",
          `Operator '${node.op}' on '${node.field}' expects a list of values.`,
          { hint: `Write ${node.field} IN ('a', 'b').` },
        );
      }
      const values = node.value.map((v) => coerce(field, node.field, v));
      const placeholder = bind(ctx, values, `Array(${chType})`);
      const positive = isArrayColumn
        ? `hasAny(${expr}, ${placeholder})`
        : `${expr} IN ${placeholder}`;
      return node.op === "in" ? positive : `(NOT ${positive})`;
    }

    case "like":
    case "not_like": {
      if (field.type !== "string") {
        throw new LwqlError(
          "type_mismatch",
          `LIKE is only valid on string fields; '${node.field}' is ${field.type}.`,
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
      const positive = isArrayColumn
        ? `arrayExists(x -> x LIKE ${placeholder}, ${expr})`
        : `${expr} LIKE ${placeholder}`;
      return node.op === "like" ? positive : `(NOT ${positive})`;
    }

    default: {
      if (node.value === undefined || Array.isArray(node.value)) {
        throw new LwqlError(
          "invalid_query",
          `Operator '${node.op}' on '${node.field}' expects a single value.`,
        );
      }
      const value = coerce(field, node.field, node.value);
      const placeholder = bind(ctx, value, chType);

      if (isArrayColumn) {
        if (node.op === "=") return `has(${expr}, ${placeholder})`;
        if (node.op === "!=") return `(NOT has(${expr}, ${placeholder}))`;
        throw new LwqlError(
          "invalid_query",
          `Operator '${node.op}' is not supported on '${node.field}'.`,
          { hint: `'${node.field}' supports =, !=, IN and LIKE.` },
        );
      }

      // `node.op` is one of the closed enum members validated by the IR schema,
      // so this is an allowlisted operator, not caller text.
      return `${expr} ${node.op} ${placeholder}`;
    }
  }
};

interface ResolvedSelect {
  sql: string;
  alias: string;
  isAggregate: boolean;
  /** Bare field name when unaggregated, for the GROUP BY completeness check. */
  fieldName?: string;
}

const resolveSelectItem = (ctx: Ctx, item: LwqlSelectItem): ResolvedSelect => {
  const alias = item.as ?? (item.fn ? `${item.fn}_${item.field === "*" ? "all" : item.field}` : item.field);

  if (item.fn) {
    if (!AGGREGATION_NAMES.includes(item.fn as never)) {
      // Match on the normalised name; report the author's spelling.
      const suggestion = closestMatch(item.fn, AGGREGATION_NAMES);
      const shown = item.fnRaw ?? item.fn;
      throw new LwqlError("unknown_function", `Unknown function '${shown}'.`, {
        hint: suggestion
          ? `Did you mean '${suggestion}'?`
          : `Available functions: ${AGGREGATION_NAMES.join(", ")}.`,
      });
    }

    if (item.field === "*") {
      if (!AGGREGATIONS_ALLOWING_STAR.has(item.fn)) {
        throw new LwqlError(
          "invalid_query",
          `'${item.fn}(*)' is not valid.`,
          { hint: `Only count(*) takes a wildcard; '${item.fn}' needs a field.` },
        );
      }
      return {
        sql: `${AGGREGATIONS.count("*")} AS \`${alias}\``,
        alias,
        isAggregate: true,
      };
    }

    const field = resolveField(ctx, item.field, "select");
    if (NUMERIC_ONLY_AGGREGATIONS.has(item.fn) && field.type !== "number") {
      throw new LwqlError(
        "type_mismatch",
        `'${item.fn}' needs a numeric field; '${item.field}' is ${field.type}.`,
        { hint: `Try count(${item.field}) instead.` },
      );
    }
    const fn = AGGREGATIONS[item.fn as keyof typeof AGGREGATIONS];
    return {
      sql: `${fn(field.selectExpr)} AS \`${alias}\``,
      alias,
      isAggregate: true,
    };
  }

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

const compileOrderBy = (
  ctx: Ctx,
  orderBy: LwqlOrderBy[],
  selected: ResolvedSelect[],
): string => {
  const terms = orderBy.map((item) => {
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

    if (item.fn) {
      const field = resolveField(ctx, item.field, "order_by");
      const fn = AGGREGATIONS[item.fn as keyof typeof AGGREGATIONS];
      return `${fn(field.selectExpr)} ${direction}`;
    }

    const field = resolveField(ctx, item.field, "order_by");
    return `${field.selectExpr} ${direction}`;
  });

  return terms.join(", ");
};

export const compile = (
  query: LwqlQuery,
  options: CompileOptions,
): CompiledQuery => {
  const entity = getEntity(query.from);
  if (!entity) {
    const suggestion = closestMatch(query.from, ENTITY_NAMES);
    throw new LwqlError("unknown_entity", `Unknown entity '${query.from}'.`, {
      hint: suggestion
        ? `Did you mean '${suggestion}'?`
        : `Available entities: ${ENTITY_NAMES.join(", ")}.`,
    });
  }

  const ctx: Ctx = {
    entity,
    entityName: query.from,
    params: {},
    paramCounter: 0,
    gating: options.gating,
  };

  const selected = query.select.map((item) => resolveSelectItem(ctx, item));

  const groupBy = query.group_by ?? [];
  const groupExprs = groupBy.map((name) => {
    const field = resolveField(ctx, name, "group_by");
    return field.selectExpr;
  });

  // A grouped query that projects a bare field not in GROUP BY returns an
  // arbitrary row's value. ClickHouse permits it; it is almost always a bug, so
  // reject it with a message that names the fix.
  const hasAggregate = selected.some((s) => s.isAggregate);
  if (hasAggregate) {
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
  } else if (groupBy.length > 0) {
    throw new LwqlError(
      "invalid_query",
      "GROUP BY requires at least one aggregate in SELECT.",
      { hint: "Add an aggregate such as count(*), or drop the GROUP BY." },
    );
  }

  // ---- tenant scope: injected here, never parsed ----
  const tenantPredicate = `${entity.tenantColumn} = ${bind(ctx, options.projectId, "String")}`;

  // ---- time bounds: always present, always clamped ----
  const now = options.now ?? Date.now();
  const requestedFrom = query.time_range?.from;
  const requestedTo = query.time_range?.to ?? now;
  const defaultFrom = now - DEFAULT_TIME_RANGE_DAYS * DAY_MS;
  const earliestAllowed = requestedTo - MAX_TIME_RANGE_DAYS * DAY_MS;
  const from = Math.max(requestedFrom ?? defaultFrom, earliestAllowed);

  if (requestedFrom !== undefined && requestedFrom < earliestAllowed) {
    throw new LwqlError(
      "limit_exceeded",
      `Time range exceeds the ${MAX_TIME_RANGE_DAYS}-day maximum.`,
      { hint: `Narrow the range to ${MAX_TIME_RANGE_DAYS} days or fewer.` },
    );
  }
  if (from > requestedTo) {
    throw new LwqlError("invalid_query", "Time range starts after it ends.");
  }

  const timePredicate =
    `${entity.timeColumn} >= ${bind(ctx, new Date(from).toISOString(), "DateTime64(3)")}` +
    ` AND ${entity.timeColumn} <= ${bind(ctx, new Date(requestedTo).toISOString(), "DateTime64(3)")}`;

  const userPredicate = normaliseWhere(query.where);
  const userSql = userPredicate ? compilePredicate(ctx, userPredicate, 0) : undefined;

  // Tenant and time are ANDed at the top level, so no `OR` the caller writes
  // can widen past them.
  const where = [tenantPredicate, timePredicate, ...(userSql ? [userSql] : [])].join(
    " AND ",
  );

  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = query.offset ?? 0;

  const parts = [
    `SELECT ${selected.map((s) => s.sql).join(", ")}`,
    `FROM ${entity.table}`,
    `WHERE ${where}`,
  ];
  if (groupExprs.length > 0) parts.push(`GROUP BY ${groupExprs.join(", ")}`);
  if (query.order_by && query.order_by.length > 0) {
    parts.push(`ORDER BY ${compileOrderBy(ctx, query.order_by, selected)}`);
  }
  // One extra row is fetched so the caller can be told the result was
  // truncated rather than silently receiving a full page.
  parts.push(`LIMIT ${limit + 1}`);
  if (offset > 0) parts.push(`OFFSET ${offset}`);

  return {
    sql: parts.join("\n"),
    params: ctx.params,
    columns: selected.map((s) => s.alias),
    limit,
  };
};
