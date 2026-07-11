import {
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parse,
  type TagToken,
  type UnaryOperatorToken,
} from "liqe";
import {
  MAX_NODE_COUNT,
  normalizeQuery,
  translateFilterToClickHouse,
} from "./ast";
import { FIELD_DEFS } from "./build-handlers";
import {
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  UNSUPPORTED,
  type Unsupported,
} from "./field-def";
import { existenceNeeds } from "./meta-handlers";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "./value-helpers";

const FIELD_DEF_BY_NAME = FIELD_DEFS as Record<string, FieldDef | undefined>;

/**
 * Evaluate a liqe query against an in-memory trace, mirroring the ClickHouse
 * compiler's node walk so the two agree.
 *
 * Fail-closed: the whole query returns `false` — never a false `true` — on any
 * parse error, unknown field, over-complex query (the exact MAX_NODE_COUNT /
 * MAX_PARAM_COUNT caps), or any tag that can't be positively evaluated at
 * dispatch time ({@link UNSUPPORTED}). An empty query has no constraints, so it
 * matches every trace (`true`), mirroring the compiler returning no WHERE clause.
 */
export function evaluateQueryInMemory(
  queryText: string,
  trace: InMemoryTrace,
): boolean {
  // Reuse the compiler as the validation gate — it enforces the exact
  // MAX_NODE_COUNT / MAX_PARAM_COUNT caps, rejects invalid syntax, and throws
  // FilterFieldUnknownError for unknown fields. Anything it rejects fails closed.
  let compiled: { sql: string; params: Record<string, unknown> } | null;
  try {
    compiled = translateFilterToClickHouse(queryText, "__in_memory__", {
      from: 0,
      to: 0,
    });
  } catch {
    return false;
  }
  // `null` means no filter (empty / whitespace) — every trace matches.
  if (compiled === null) return true;

  let ast: LiqeQuery;
  try {
    ast = parse(normalizeQuery(queryText));
  } catch {
    return false;
  }

  const result = evaluateNode(ast, false, trace, { nodeCount: 0 });
  // UNSUPPORTED anywhere ⇒ the query can't be positively evaluated ⇒ false.
  return result === true;
}

interface WalkState {
  nodeCount: number;
}

function evaluateNode(
  node: LiqeQuery,
  negated: boolean,
  trace: InMemoryTrace,
  state: WalkState,
): boolean | Unsupported {
  state.nodeCount++;
  if (state.nodeCount > MAX_NODE_COUNT) return UNSUPPORTED;

  switch (node.type) {
    case "EmptyExpression":
      return true;

    case "Tag":
      return evaluateTag(node as TagToken, negated, trace);

    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      // Negation threads down unchanged and the operator stays as-is — the
      // exact shape `translateNode` compiles, so both sides always agree.
      const left = evaluateNode(logExpr.left, negated, trace, state);
      if (left === UNSUPPORTED) return UNSUPPORTED;
      const right = evaluateNode(logExpr.right, negated, trace, state);
      if (right === UNSUPPORTED) return UNSUPPORTED;
      return logExpr.operator.operator === "OR" ? left || right : left && right;
    }

    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      return evaluateNode(unary.operand, negated !== isNeg, trace, state);
    }

    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      return evaluateNode(paren.expression, negated, trace, state);
    }

    default:
      return UNSUPPORTED;
  }
}

function evaluateTag(
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
  if (tag.field.type === "ImplicitField") {
    return evaluateFreeText(tag, negated, trace);
  }

  const fieldName = tag.field.name;

  // Attribute prefixes — mirror `translateTag`'s routing order exactly.
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
    return evaluateTraceAttribute(
      fieldName.slice(TRACE_ATTRIBUTE_PREFIX.length),
      tag,
      negated,
      trace,
    );
  }
  if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
    // span.attribute.<k> resolves via stored_spans; spans aren't derived at
    // dispatch time yet.
    return UNSUPPORTED;
  }
  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
    return evaluateEventAttribute(
      fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length),
      tag,
      negated,
      trace,
    );
  }
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    return evaluateTraceAttribute(
      fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length),
      tag,
      negated,
      trace,
    );
  }
  if (
    fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) &&
    fieldName !== "event"
  ) {
    return evaluateEventAttribute(
      fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length),
      tag,
      negated,
      trace,
    );
  }

  const def = FIELD_DEF_BY_NAME[fieldName];
  // Unknown field — the gate already rejected it; defensive fail-closed.
  if (!def) return UNSUPPORTED;
  return def.evaluateInMemory(tag, negated, trace);
}

function evaluateFreeText(
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean {
  // ILIKE %value% over the computed input/output — case-insensitive contains.
  const value = extractStringValue(tag).toLowerCase();
  const input = (trace.summary.computedInput ?? "").toLowerCase();
  const output = (trace.summary.computedOutput ?? "").toLowerCase();
  const matched = input.includes(value) || output.includes(value);
  return negated ? !matched : matched;
}

function evaluateTraceAttribute(
  key: string,
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
  // Empty key throws on the SQL side (422) — fail closed.
  if (!key) return UNSUPPORTED;
  const value = extractStringValue(tag);
  const matched = (trace.summary.attributes[key] ?? "") === value;
  return negated ? !matched : matched;
}

function evaluateEventAttribute(
  key: string,
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
  if (!key) return UNSUPPORTED;
  if (trace.events == null) return UNSUPPORTED;
  const value = extractStringValue(tag);
  const matched = trace.events.some(
    (e) => (e.attributes[key] ?? "") === value,
  );
  return negated ? !matched : matched;
}

// ---------------------------------------------------------------------------
// queryNeeds — which auxiliary collections a query references, so a dispatcher
// can load only what it needs (parallels `triggerFiltersReferenceEvents`).
// ---------------------------------------------------------------------------

export function queryNeeds(queryText: string): Set<FieldNeeds> {
  const needs = new Set<FieldNeeds>();
  let ast: LiqeQuery;
  try {
    ast = parse(normalizeQuery(queryText));
  } catch {
    return needs;
  }
  collectNeeds(ast, needs);
  return needs;
}

function collectNeeds(node: LiqeQuery, needs: Set<FieldNeeds>): void {
  switch (node.type) {
    case "Tag":
      collectTagNeeds(node as TagToken, needs);
      return;
    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      collectNeeds(logExpr.left, needs);
      collectNeeds(logExpr.right, needs);
      return;
    }
    case "UnaryOperator":
      collectNeeds((node as UnaryOperatorToken).operand, needs);
      return;
    case "ParenthesizedExpression":
      collectNeeds((node as ParenthesizedExpressionToken).expression, needs);
      return;
    default:
      return;
  }
}

function collectTagNeeds(tag: TagToken, needs: Set<FieldNeeds>): void {
  if (tag.field.type === "ImplicitField") return;
  const fieldName = tag.field.name;

  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) return;
  if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
    needs.add("spans");
    return;
  }
  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
    needs.add("events");
    return;
  }
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) return;
  if (
    fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) &&
    fieldName !== "event"
  ) {
    needs.add("events");
    return;
  }

  // has/none are value-polymorphic — resolve the referenced collection (if any)
  // from the value rather than a static `FieldDef.needs`.
  if (fieldName === "has" || fieldName === "none") {
    try {
      const need = existenceNeeds(extractStringValue(tag));
      if (need) needs.add(need);
    } catch {
      // Non-literal value — nothing to resolve.
    }
    return;
  }

  const def = FIELD_DEF_BY_NAME[fieldName];
  if (def?.needs) needs.add(def.needs);
}
