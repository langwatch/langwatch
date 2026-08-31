import { FilterParseError, type TagToken } from "@langwatch/trace-contract";
import {
  type CategoricalRead,
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  type RangeRead,
  UNSUPPORTED,
  type Unsupported,
  type FieldHandler,
  type TranslationContext,
} from "./trace-query-evaluation.adapter";
import { boundedSubquery } from "./trace-query-subquery.clickhouse.adapter";
import { TraceQueryValues } from "./trace-query-values.clickhouse.adapter";

// ---------------------------------------------------------------------------
// ClickHouse compilation (unchanged output — the byte-identical invariant)
// ---------------------------------------------------------------------------

const NUMERIC_OP_MAP: Record<string, string> = {
  ":": "=",
  ":>": ">",
  ":<": "<",
  ":>=": ">=",
  ":<=": "<=",
};

// ---------------------------------------------------------------------------
// In-memory evaluation (mirrors the SQL each compiler emits)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Field-def builders (both sides)
// ---------------------------------------------------------------------------

/**
 * How one field becomes one predicate.
 *
 * The four entry points are the shapes a field can be filtered by — a
 * categorical match or a numeric range, each either on the row itself or
 * across a joined table — and everything else is a step they share. Three of
 * those steps were exported and called by nobody.
 *
 * The cross-table pair is the one worth naming: it filters a trace by
 * something stored on its spans, which is a subquery rather than a column, and
 * conflating it with the same-row case is how a filter silently matches
 * every trace that has any span rather than the traces whose spans match.
 */
export class TraceQueryTranslators {
  private static translateNumericField(
    columnExpr: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
    name = "value",
  ): string {
    if (tag.expression.type === "RangeExpression") {
      const min = tag.expression.range.min;
      const max = tag.expression.range.max;
      const pMin = TraceQueryValues.nextParam(ctx, `${name}Min`);
      const pMax = TraceQueryValues.nextParam(ctx, `${name}Max`);
      ctx.params[pMin] = min;
      ctx.params[pMax] = max;
      return TraceQueryValues.wrap(
        `(${columnExpr} >= {${pMin}:Float64} AND ${columnExpr} <= {${pMax}:Float64})`,
        negated,
      );
    }

    const operator = tag.operator.operator;
    const num = TraceQueryValues.extractNumericValue(tag);
    const p = TraceQueryValues.nextParam(ctx, name);
    ctx.params[p] = num;

    switch (operator) {
      case ":":
        return TraceQueryValues.wrap(`${columnExpr} = {${p}:Float64}`, negated);
      case ":>":
        return TraceQueryValues.wrap(`${columnExpr} > {${p}:Float64}`, negated);
      case ":<":
        return TraceQueryValues.wrap(`${columnExpr} < {${p}:Float64}`, negated);
      case ":>=":
        return TraceQueryValues.wrap(`${columnExpr} >= {${p}:Float64}`, negated);
      case ":<=":
        return TraceQueryValues.wrap(`${columnExpr} <= {${p}:Float64}`, negated);
      default:
        throw new FilterParseError(`Unsupported operator: ${operator}`);
    }
  }

  private static translateStringField(
    columnExpr: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
    name = "value",
  ): string {
    const value = TraceQueryValues.extractStringValue(tag);
    TraceQueryValues.validateValueLength(value);
    const p = TraceQueryValues.nextParam(ctx, name);
    ctx.params[p] = value;
    return TraceQueryValues.wrap(`${columnExpr} = {${p}:String}`, negated);
  }

  private static stringEqualityHandler(expression: string, name?: string): FieldHandler {
    return (tag, negated, ctx) =>
      TraceQueryTranslators.translateStringField(expression, tag, negated, ctx, name);
  }

  private static numericComparisonHandler(expression: string, name?: string): FieldHandler {
    return (tag, negated, ctx) =>
      TraceQueryTranslators.translateNumericField(expression, tag, negated, ctx, name);
  }

  private static crossTableStringHandler(
    table: string,
    timeColumn: string,
    expression: string,
    name = "value",
  ): FieldHandler {
    return (tag, negated, ctx) => {
      const value = TraceQueryValues.extractStringValue(tag);
      TraceQueryValues.validateValueLength(value);
      const p = TraceQueryValues.nextParam(ctx, name);
      ctx.params[p] = value;
      return TraceQueryValues.wrap(
        boundedSubquery(table, timeColumn, `${expression} = {${p}:String}`),
        negated,
      );
    };
  }

  private static crossTableNumericHandler(
    table: string,
    timeColumn: string,
    expression: string,
    name = "value",
  ): FieldHandler {
    return (tag, negated, ctx) => {
      if (tag.expression.type === "RangeExpression") {
        const min = tag.expression.range.min;
        const max = tag.expression.range.max;
        const pMin = TraceQueryValues.nextParam(ctx, `${name}Min`);
        const pMax = TraceQueryValues.nextParam(ctx, `${name}Max`);
        ctx.params[pMin] = min;
        ctx.params[pMax] = max;
        return TraceQueryValues.wrap(
          boundedSubquery(
            table,
            timeColumn,
            `${expression} >= {${pMin}:Float64} AND ${expression} <= {${pMax}:Float64}`,
          ),
          negated,
        );
      }
      const operator = tag.operator.operator;
      const num = TraceQueryValues.extractNumericValue(tag);
      const p = TraceQueryValues.nextParam(ctx, name);
      ctx.params[p] = num;
      const cmp = NUMERIC_OP_MAP[operator];
      if (!cmp) {
        throw new FilterParseError(`Unsupported operator: ${operator}`);
      }
      return TraceQueryValues.wrap(
        boundedSubquery(table, timeColumn, `${expression} ${cmp} {${p}:Float64}`),
        negated,
      );
    };
  }

  /**
   * Numeric comparison mirroring {@link translateNumericField}: inclusive
   * `[min TO max]` ranges (ClickHouse always emits `>=`/`<=`, ignoring liqe's
   * inclusivity flags) and the single-value operators.
   */
  private static matchNumericInMemory(value: number, tag: TagToken): boolean {
    if (tag.expression.type === "RangeExpression") {
      const min = tag.expression.range.min;
      const max = tag.expression.range.max;
      return value >= min && value <= max;
    }
    const num = TraceQueryValues.extractNumericValue(tag);
    switch (tag.operator.operator) {
      case ":":
        return value === num;
      case ":>":
        return value > num;
      case ":<":
        return value < num;
      case ":>=":
        return value >= num;
      case ":<=":
        return value <= num;
      default:
        throw new FilterParseError(`Unsupported operator: ${tag.operator.operator}`);
    }
  }

  private static evaluateCategorical(
    read: CategoricalRead,
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ): boolean | Unsupported {
    const actual = read(trace);
    if (actual === UNSUPPORTED) return UNSUPPORTED;
    const target = TraceQueryValues.extractStringValue(tag);
    // A `null` scalar mirrors a NULL ClickHouse column: `col = x` and
    // `NOT (col = x)` both yield NULL, i.e. the row is excluded either way.
    if (actual === null) return false;
    const values = Array.isArray(actual) ? actual : [actual];
    const matched = values.includes(target);
    return negated ? !matched : matched;
  }

  private static evaluateRange(
    read: RangeRead,
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ): boolean | Unsupported {
    const actual = read(trace);
    if (actual === UNSUPPORTED) return UNSUPPORTED;
    // NULL numeric column: excluded under both polarities (see above).
    if (actual === null) return false;
    const values = Array.isArray(actual) ? actual : [actual];
    const matched = values.some((v) => TraceQueryTranslators.matchNumericInMemory(v, tag));
    return negated ? !matched : matched;
  }

  /** Direct string equality on a `trace_summaries` expression. */
  static categorical(expression: string, read: CategoricalRead, name?: string): FieldDef {
    return {
      toClickHouse: TraceQueryTranslators.stringEqualityHandler(expression, name),
      evaluateInMemory: (tag, negated, trace) =>
        TraceQueryTranslators.evaluateCategorical(read, tag, negated, trace),
    };
  }

  /** Numeric comparison on a `trace_summaries` expression. */
  static range(expression: string, read: RangeRead, name?: string): FieldDef {
    return {
      toClickHouse: TraceQueryTranslators.numericComparisonHandler(expression, name),
      evaluateInMemory: (tag, negated, trace) =>
        TraceQueryTranslators.evaluateRange(read, tag, negated, trace),
    };
  }

  /**
   * String equality answered by a partition-pruned subquery on another table
   * (`evaluation_runs` / `stored_spans`). `read` collects the candidate values
   * from the referenced collection (or {@link UNSUPPORTED} when it isn't loaded).
   */
  static crossTableCategorical(
    table: string,
    timeColumn: string,
    expression: string,
    read: CategoricalRead,
    needs: FieldNeeds,
    name = "value",
  ): FieldDef {
    return {
      needs,
      toClickHouse: TraceQueryTranslators.crossTableStringHandler(
        table,
        timeColumn,
        expression,
        name,
      ),
      evaluateInMemory: (tag, negated, trace) =>
        TraceQueryTranslators.evaluateCategorical(read, tag, negated, trace),
    };
  }

  /** Numeric comparison answered by a partition-pruned cross-table subquery. */
  static crossTableRange(
    table: string,
    timeColumn: string,
    expression: string,
    read: RangeRead,
    needs: FieldNeeds,
    name = "value",
  ): FieldDef {
    return {
      needs,
      toClickHouse: TraceQueryTranslators.crossTableNumericHandler(
        table,
        timeColumn,
        expression,
        name,
      ),
      evaluateInMemory: (tag, negated, trace) =>
        TraceQueryTranslators.evaluateRange(read, tag, negated, trace),
    };
  }
}
