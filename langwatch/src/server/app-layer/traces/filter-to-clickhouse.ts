import {
  parse,
  type LiqeQuery,
  type TagToken,
  type UnaryOperatorToken,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
} from "liqe";
import { FilterParseError, FilterFieldUnknownError } from "./errors";
import { FACET_REGISTRY, TABLE_TIME_COLUMNS } from "./facet-registry";

const MAX_NODE_COUNT = 20;
const MAX_VALUE_LENGTH = 500;
const MAX_PARAM_COUNT = 50;

interface TranslationContext {
  paramCounter: number;
  nodeCount: number;
  params: Record<string, unknown>;
  tenantId: string;
  timeRange: { from: number; to: number };
}

type FieldHandler = (
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
) => string;

/**
 * Translate a liqe query string into a parameterized ClickHouse WHERE clause fragment.
 * Returns null for empty/whitespace queries.
 * Throws FilterParseError for invalid syntax or overly complex queries.
 * Throws FilterFieldUnknownError for unrecognized field names.
 */
export function translateFilterToClickHouse(
  queryText: string,
  tenantId: string,
  timeRange: { from: number; to: number },
): { sql: string; params: Record<string, unknown> } | null {
  const trimmed = queryText.trim();
  if (!trimmed) return null;

  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    throw new FilterParseError("Invalid filter syntax");
  }

  if (ast.type === "EmptyExpression") return null;

  const ctx: TranslationContext = {
    paramCounter: 0,
    nodeCount: 0,
    params: {
      tenantId,
      timeFrom: timeRange.from,
      timeTo: timeRange.to,
    },
    tenantId,
    timeRange,
  };

  const sql = translateNode(ast, false, ctx);

  if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
    throw new FilterParseError("Too many filter conditions");
  }

  return { sql, params: ctx.params };
}

// ---------------------------------------------------------------------------
// AST traversal
// ---------------------------------------------------------------------------

function translateNode(
  node: LiqeQuery,
  negated: boolean,
  ctx: TranslationContext,
): string {
  ctx.nodeCount++;
  if (ctx.nodeCount > MAX_NODE_COUNT) {
    throw new FilterParseError("Query too complex");
  }

  switch (node.type) {
    case "EmptyExpression":
      return "1 = 1";

    case "Tag":
      return translateTag(node as TagToken, negated, ctx);

    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      const left = translateNode(logExpr.left, negated, ctx);
      const right = translateNode(logExpr.right, negated, ctx);
      const op = logExpr.operator.operator === "OR" ? "OR" : "AND";
      return `(${left} ${op} ${right})`;
    }

    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      return translateNode(unary.operand, negated !== isNeg, ctx);
    }

    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      return `(${translateNode(paren.expression, negated, ctx)})`;
    }

    default:
      throw new FilterParseError(`Unsupported query syntax: ${(node as { type: string }).type}`);
  }
}

function translateTag(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  if (tag.field.type === "ImplicitField") {
    return translateFreeText(tag, negated, ctx);
  }

  const fieldName = tag.field.name;

  // attribute.<key> — dynamic per-attribute filtering, can't be enumerated
  // up front so it bypasses the static handler map.
  if (fieldName.startsWith(ATTRIBUTE_PREFIX)) {
    return translateAttributeField(fieldName, tag, negated, ctx);
  }

  const handler = FIELD_HANDLERS[fieldName];

  if (!handler) {
    throw new FilterFieldUnknownError(fieldName, KNOWN_FIELDS);
  }

  return handler(tag, negated, ctx);
}

const ATTRIBUTE_PREFIX = "attribute.";

function translateAttributeField(
  fieldName: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const attrKey = fieldName.slice(ATTRIBUTE_PREFIX.length);
  if (!attrKey) {
    throw new FilterParseError("attribute.<key> requires a key after the dot");
  }
  const value = extractStringValue(tag);
  validateValueLength(value);
  const pKey = nextParam(ctx);
  const pVal = nextParam(ctx);
  ctx.params[pKey] = attrKey;
  ctx.params[pVal] = value;
  return wrap(
    `Attributes[{${pKey}:String}] = {${pVal}:String}`,
    negated,
  );
}

function translateFreeText(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const paramName = nextParam(ctx);
  ctx.params[paramName] = `%${value}%`;

  const clause = `(ComputedInput ILIKE {${paramName}:String} OR ComputedOutput ILIKE {${paramName}:String})`;
  return negated ? `NOT ${clause}` : clause;
}

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

function extractStringValue(tag: TagToken): string {
  if (tag.expression.type === "LiteralExpression") {
    return String(tag.expression.value);
  }
  if (tag.expression.type === "RegexExpression") {
    return String(tag.expression.value);
  }
  throw new FilterParseError("Unsupported value expression");
}

function extractNumericValue(tag: TagToken): number {
  if (tag.expression.type !== "LiteralExpression") {
    throw new FilterParseError("Expected a numeric value");
  }
  const raw = tag.expression.value;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (Number.isNaN(num)) {
    throw new FilterParseError(`Not a number: ${String(raw)}`);
  }
  return num;
}

function nextParam(ctx: TranslationContext): string {
  const name = `f${ctx.paramCounter}`;
  ctx.paramCounter++;
  return name;
}

function validateValueLength(value: string): void {
  if (value.length > MAX_VALUE_LENGTH) {
    throw new FilterParseError(
      `Filter value too long (max ${MAX_VALUE_LENGTH} characters)`,
    );
  }
}

function wrap(sql: string, negated: boolean): string {
  return negated ? `NOT (${sql})` : sql;
}

function boundedSubquery(
  table: string,
  timeCol: string,
  innerWhere: string,
): string {
  return `TraceId IN (SELECT DISTINCT TraceId FROM ${table} WHERE TenantId = {tenantId:String} AND ${timeCol} >= fromUnixTimestamp64Milli({timeFrom:Int64}) AND ${timeCol} <= fromUnixTimestamp64Milli({timeTo:Int64}) AND ${innerWhere})`;
}

// ---------------------------------------------------------------------------
// Generic translators (reused by handler factories)
// ---------------------------------------------------------------------------

function translateNumericField(
  columnExpr: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  if (tag.expression.type === "RangeExpression") {
    const min = tag.expression.range.min;
    const max = tag.expression.range.max;
    const pMin = nextParam(ctx);
    const pMax = nextParam(ctx);
    ctx.params[pMin] = min;
    ctx.params[pMax] = max;
    return wrap(
      `(${columnExpr} >= {${pMin}:Float64} AND ${columnExpr} <= {${pMax}:Float64})`,
      negated,
    );
  }

  const operator = tag.operator.operator;
  const num = extractNumericValue(tag);
  const p = nextParam(ctx);
  ctx.params[p] = num;

  switch (operator) {
    case ":":
      return wrap(`${columnExpr} = {${p}:Float64}`, negated);
    case ":>":
      return wrap(`${columnExpr} > {${p}:Float64}`, negated);
    case ":<":
      return wrap(`${columnExpr} < {${p}:Float64}`, negated);
    case ":>=":
      return wrap(`${columnExpr} >= {${p}:Float64}`, negated);
    case ":<=":
      return wrap(`${columnExpr} <= {${p}:Float64}`, negated);
    default:
      throw new FilterParseError(`Unsupported operator: ${operator}`);
  }
}

function translateStringField(
  columnExpr: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const p = nextParam(ctx);
  ctx.params[p] = value;
  return wrap(`${columnExpr} = {${p}:String}`, negated);
}

// ---------------------------------------------------------------------------
// Handler factories — derive from FACET_REGISTRY expressions
// ---------------------------------------------------------------------------

function stringEquality(expression: string): FieldHandler {
  return (tag, negated, ctx) =>
    translateStringField(expression, tag, negated, ctx);
}

function crossTableStringEquality(
  table: string,
  timeColumn: string,
  expression: string,
): FieldHandler {
  return (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(table, timeColumn, `${expression} = {${p}:String}`),
      negated,
    );
  };
}

function numericComparison(expression: string): FieldHandler {
  return (tag, negated, ctx) =>
    translateNumericField(expression, tag, negated, ctx);
}

// ---------------------------------------------------------------------------
// Custom handlers — facets needing special SQL beyond what the factory derives
// ---------------------------------------------------------------------------

const CUSTOM_FACET_HANDLERS: Record<string, FieldHandler> = {
  model: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);

    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return wrap(
        `arrayExists(m -> m LIKE {${p}:String}, Models)`,
        negated,
      );
    }

    ctx.params[p] = value;
    return wrap(`has(Models, {${p}:String})`, negated);
  },

  label: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
    ctx.params[p] = value;
    return wrap(
      `arrayExists(x -> trim(BOTH '"' FROM x) = {${p}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
      negated,
    );
  },

  evaluator: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(
        "evaluation_runs",
        "ScheduledAt",
        `EvaluatorId = {${p}:String}`,
      ),
      negated,
    );
  },
};

// ---------------------------------------------------------------------------
// Meta-field handlers — search-only fields not in FACET_REGISTRY
// ---------------------------------------------------------------------------

/**
 * Built-in existence categories for `has:` and `none:`.
 * `attribute.<key>` is also accepted dynamically.
 */
const HAS_VALUES = [
  "error",
  "eval",
  "feedback",
  "annotation",
  "conversation",
  "user",
  "topic",
  "subtopic",
  "label",
] as const;

function translateExistence(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);

  // Dynamic per-attribute existence: `has:attribute.langwatch.user_id`
  if (value.startsWith(ATTRIBUTE_PREFIX)) {
    const attrKey = value.slice(ATTRIBUTE_PREFIX.length);
    if (!attrKey) {
      throw new FilterParseError("attribute.<key> requires a key after the dot");
    }
    const p = nextParam(ctx);
    ctx.params[p] = attrKey;
    return wrap(`Attributes[{${p}:String}] != ''`, negated);
  }

  switch (value) {
    case "error":
      return wrap("ContainsErrorStatus = 1", negated);

    case "eval":
      return wrap(
        boundedSubquery("evaluation_runs", "ScheduledAt", "1 = 1"),
        negated,
      );

    case "feedback":
      return wrap(
        boundedSubquery(
          "stored_spans",
          "StartTime",
          "has(`Events.Name`, 'user_feedback')",
        ),
        negated,
      );

    case "annotation":
      return wrap("length(AnnotationIds) > 0", negated);

    case "conversation":
      return wrap("Attributes['gen_ai.conversation.id'] != ''", negated);

    case "user":
      return wrap("Attributes['langwatch.user_id'] != ''", negated);

    case "topic":
      return wrap("ifNull(TopicId, '') != ''", negated);

    case "subtopic":
      return wrap("ifNull(SubTopicId, '') != ''", negated);

    case "label":
      return wrap(
        "Attributes['langwatch.labels'] != '' AND Attributes['langwatch.labels'] != '[]'",
        negated,
      );

    default:
      throw new FilterParseError(
        `Unknown has/none value "${value}". Valid: ${HAS_VALUES.join(", ")}, attribute.<key>`,
      );
  }
}

const META_HANDLERS: Record<string, FieldHandler> = {
  has: (tag, negated, ctx) => translateExistence(tag, negated, ctx),
  none: (tag, negated, ctx) => translateExistence(tag, !negated, ctx),

  eval: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(
        "evaluation_runs",
        "ScheduledAt",
        `EvaluatorName = {${p}:String}`,
      ),
      negated,
    );
  },

  event: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(
        "stored_spans",
        "StartTime",
        `has(\`Events.Name\`, {${p}:String})`,
      ),
      negated,
    );
  },

  trace: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);

    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return wrap(`TraceId LIKE {${p}:String}`, negated);
    }

    ctx.params[p] = value;
    return wrap(`TraceId = {${p}:String}`, negated);
  },
};

// ---------------------------------------------------------------------------
// Build complete handler map from FACET_REGISTRY + overrides + meta
// ---------------------------------------------------------------------------

function buildFieldHandlers(): Record<string, FieldHandler> {
  const handlers: Record<string, FieldHandler> = {};

  for (const def of FACET_REGISTRY) {
    // Dynamic keys are not directly filterable as a single field
    if (def.kind === "dynamic_keys") continue;

    // Custom override takes precedence
    const custom = CUSTOM_FACET_HANDLERS[def.key];
    if (custom) {
      handlers[def.key] = custom;
      continue;
    }

    // Auto-derive from facet definition
    if (def.kind === "categorical" && "expression" in def) {
      if (def.table === "trace_summaries") {
        handlers[def.key] = stringEquality(def.expression);
      } else {
        handlers[def.key] = crossTableStringEquality(
          def.table,
          TABLE_TIME_COLUMNS[def.table],
          def.expression,
        );
      }
    } else if (def.kind === "range") {
      handlers[def.key] = numericComparison(def.expression);
    }
    // Query-builder categoricals without custom handler are skipped
  }

  // Meta-fields that don't correspond to registry facets
  Object.assign(handlers, META_HANDLERS);

  return handlers;
}

const FIELD_HANDLERS = buildFieldHandlers();

/** All known filter field names, derived from registry + meta-fields. */
export const KNOWN_FIELDS = Object.keys(FIELD_HANDLERS);
