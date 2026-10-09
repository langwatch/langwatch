import {
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  type TagToken,
  type UnaryOperatorToken,
  UNSUPPORTED,
  type Unsupported,
} from "@langwatch/trace-contract";

import { classifyExistenceSource } from "./trace-query-meta-fields.rules.ts";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  readAttribute,
} from "./trace-query-values.rules.ts";

/**
 * The in-memory mirror's leaves: one tag against a trace, and the auxiliary
 * collections a query references, plain fields looked up in `fieldDefs`.
 */

export function evaluateTraceTag({
  tag,
  negated,
  trace,
  fieldDefs,
}: {
  tag: TagToken;
  negated: boolean;
  trace: InMemoryTrace;
  fieldDefs: ReadonlyMap<string, FieldDef>;
}): boolean | Unsupported {
  if (tag.field.type === "ImplicitField") {
    return evaluateFreeText(tag, negated, trace);
  }

  const fieldName = tag.field.name;

  // Attribute prefixes — mirror `translateTag`'s routing order exactly.
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
    return evaluateTraceAttribute({
      key: fieldName.slice(TRACE_ATTRIBUTE_PREFIX.length),
      tag,
      negated,
      trace,
    });
  }

  if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
    // span.attribute.<k> resolves via stored_spans; spans aren't derived at
    // dispatch time yet.
    return UNSUPPORTED;
  }

  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
    return evaluateEventAttribute({
      key: fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length),
      tag,
      negated,
      trace,
    });
  }

  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    return evaluateTraceAttribute({
      key: fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length),
      tag,
      negated,
      trace,
    });
  }

  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
    return evaluateEventAttribute({
      key: fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length),
      tag,
      negated,
      trace,
    });
  }

  // `.get()` — own keys only, so `constructor` / `toString` / `__proto__` are
  // unknown fields rather than inherited `Object.prototype` members that pass
  // this guard and then blow up on `def.evaluateInMemory(...)`.
  const def = fieldDefs.get(fieldName);
  // Unknown field — the gate already rejected it; defensive fail-closed.
  if (!def) {
    return UNSUPPORTED;
  }

  return def.evaluateInMemory(tag, negated, trace);
}

function evaluateFreeText(tag: TagToken, negated: boolean, trace: InMemoryTrace): boolean {
  // Mirrors translateFreeText's OR of ILIKE checks, including CH's
  // three-valued logic over Nullable(String) I/O — a match on one column
  // counts even when the other is NULL, but a negated filter never matches
  // a trace whose non-matching side has a NULL column. Span names need rows
  // the dispatcher may not load; absent, this is deliberately NARROWER than SQL.
  const value = extractStringValue(tag).toLowerCase();
  const inputMatch = computeIlikeContains(trace.summary.computedInput, value);
  const outputMatch = computeIlikeContains(trace.summary.computedOutput, value);
  // `?? ""` rather than a bare deref: the type says string, but the only place
  // that coalesce actually happens is the analytics repository's row mapping, so
  // a summary built from a fold state that predates the field would throw here
  // and take the whole evaluation (including trigger dispatch) down with it.
  const nameMatch = (trace.summary.traceName ?? "").toLowerCase().includes(value);
  const spanMatch = trace.spans?.some((s) => s.name.toLowerCase().includes(value)) ?? false;

  let matched: boolean | null;
  if (inputMatch === true || outputMatch === true || nameMatch || spanMatch) {
    matched = true;
  } else if (inputMatch === null || outputMatch === null) {
    matched = null;
  } else {
    matched = false;
  }
  let result = matched;
  if (negated && matched !== null) {
    result = !matched;
  }

  return result === true;
}

/** `column ILIKE %value%` with SQL semantics: NULL column → NULL, not false. */
function computeIlikeContains(
  column: string | null | undefined,
  lowerValue: string,
): boolean | null {
  if (column == null) {
    return null;
  }

  return column.toLowerCase().includes(lowerValue);
}

function evaluateTraceAttribute({
  key,
  tag,
  negated,
  trace,
}: {
  key: string;
  tag: TagToken;
  negated: boolean;
  trace: InMemoryTrace;
}): boolean | Unsupported {
  // Empty key throws on the SQL side (422) — fail closed.
  if (!key) {
    return UNSUPPORTED;
  }

  const value = extractStringValue(tag);
  const matched = readAttribute(trace.summary.attributes, key) === value;

  return negated ? !matched : matched;
}

function evaluateEventAttribute({
  key,
  tag,
  negated,
  trace,
}: {
  key: string;
  tag: TagToken;
  negated: boolean;
  trace: InMemoryTrace;
}): boolean | Unsupported {
  if (!key) {
    return UNSUPPORTED;
  }

  if (trace.events == null) {
    return UNSUPPORTED;
  }

  const value = extractStringValue(tag);
  const matched = trace.events.some((e) => readAttribute(e.attributes, key) === value);

  return negated ? !matched : matched;
}

export function collectQueryNeeds({
  node,
  needs,
  fieldDefs,
}: {
  node: LiqeQuery;
  needs: Set<FieldNeeds>;
  fieldDefs: ReadonlyMap<string, FieldDef>;
}): void {
  switch (node.type) {
    case "Tag":
      collectTagNeeds(node as TagToken, needs, fieldDefs);
      return;
    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      collectQueryNeeds({ node: logExpr.left, needs, fieldDefs });
      collectQueryNeeds({ node: logExpr.right, needs, fieldDefs });

      return;
    }
    case "UnaryOperator":
      collectQueryNeeds({ node: (node as UnaryOperatorToken).operand, needs, fieldDefs });
      return;
    case "ParenthesizedExpression":
      collectQueryNeeds({
        node: (node as ParenthesizedExpressionToken).expression,
        needs,
        fieldDefs,
      });
      return;
    default:
      return;
  }
}

function collectTagNeeds(
  tag: TagToken,
  needs: Set<FieldNeeds>,
  fieldDefs: ReadonlyMap<string, FieldDef>,
): void {
  // Free text reaches span names through a `stored_spans` subquery, so the
  // in-memory mirror needs the span rows to answer it without failing closed.
  if (tag.field.type === "ImplicitField") {
    needs.add("spans");

    return;
  }

  const fieldName = tag.field.name;

  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
    return;
  }

  if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
    needs.add("spans");

    return;
  }

  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
    needs.add("events");

    return;
  }

  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    return;
  }

  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
    needs.add("events");

    return;
  }

  // has/none are value-polymorphic — resolve the referenced collection (if any)
  // from the value rather than a static `FieldDef.needs`.
  if (fieldName === "has" || fieldName === "none") {
    try {
      const need = classifyExistenceSource(extractStringValue(tag));
      if (need) {
        needs.add(need);
      }
    } catch {
      // Non-literal value — nothing to resolve.
      return;
    }

    return;
  }

  const def = fieldDefs.get(fieldName);
  if (def?.needs) {
    needs.add(def.needs);
  }
}

// ---------------------------------------------------------------------------
// needs — which auxiliary collections a query references, so a dispatcher
// can load only what it needs (parallels `triggerFiltersReferenceEvents`).
// ---------------------------------------------------------------------------
