import {
  FilterParseError,
  type TagToken,
  type CategoricalRead,
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  type RangeRead,
  UNSUPPORTED,
  type Unsupported,
  type FieldHandler,
  type TranslationContext,
} from "@langwatch/trace-contract";

import { ClickHouseTraceQuerySubqueryRepository } from "./clickhouse.trace-query-subquery.repository.ts";
import { ClickHouseTraceQueryValuesRepository } from "./clickhouse.trace-query-values.repository.ts";

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
 * Field translators for categorical/range filters on single-row and cross-table predicates.
 */
export class ClickHouseTraceQueryTranslatorsRepository {
  private constructor(
    private readonly subqueries: ClickHouseTraceQuerySubqueryRepository,
    private readonly values: ClickHouseTraceQueryValuesRepository,
  ) {}

  static create(): ClickHouseTraceQueryTranslatorsRepository {
    return new ClickHouseTraceQueryTranslatorsRepository(
      ClickHouseTraceQuerySubqueryRepository.create(),
      ClickHouseTraceQueryValuesRepository.create(),
    );
  }

  private translateNumericField(
    columnExpr: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
    name = "value",
  ): string {
    if (tag.expression.type === "RangeExpression") {
      const min = tag.expression.range.min;
      const max = tag.expression.range.max;
      const pMin = this.values.nextParam(ctx, `${name}Min`);
      const pMax = this.values.nextParam(ctx, `${name}Max`);
      ctx.params[pMin] = min;
      ctx.params[pMax] = max;
      return this.values.wrap(
        `(${columnExpr} >= {${pMin}:Float64} AND ${columnExpr} <= {${pMax}:Float64})`,
        negated,
      );
    }

    const operator = tag.operator.operator;
    const num = this.values.extractNumericValue(tag);
    const p = this.values.nextParam(ctx, name);
    ctx.params[p] = num;

    switch (operator) {
      case ":":
        return this.values.wrap(`${columnExpr} = {${p}:Float64}`, negated);
      case ":>":
        return this.values.wrap(`${columnExpr} > {${p}:Float64}`, negated);
      case ":<":
        return this.values.wrap(`${columnExpr} < {${p}:Float64}`, negated);
      case ":>=":
        return this.values.wrap(`${columnExpr} >= {${p}:Float64}`, negated);
      case ":<=":
        return this.values.wrap(`${columnExpr} <= {${p}:Float64}`, negated);
      default:
        throw new FilterParseError(`Unsupported operator: ${operator}`);
    }
  }

  private translateStringField(
    columnExpr: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
    name = "value",
  ): string {
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const p = this.values.nextParam(ctx, name);
    ctx.params[p] = value;
    return this.values.wrap(`${columnExpr} = {${p}:String}`, negated);
  }

  /** `expression = value`, bound; the value's parameter is minted from `name`. */
  stringEqualityHandler(expression: string, name?: string): FieldHandler {
    return (tag, negated, ctx) => this.translateStringField(expression, tag, negated, ctx, name);
  }

  /** `expression <op> value` or an inclusive range, bound as Float64. */
  numericComparisonHandler(expression: string, name?: string): FieldHandler {
    return (tag, negated, ctx) => this.translateNumericField(expression, tag, negated, ctx, name);
  }

  private crossTableStringHandler(
    table: string,
    timeColumn: string,
    expression: string,
    name = "value",
  ): FieldHandler {
    return (tag, negated, ctx) => {
      const value = this.values.extractStringValue(tag);
      this.values.validateValueLength(value);
      const p = this.values.nextParam(ctx, name);
      ctx.params[p] = value;
      return this.values.wrap(
        this.subqueries.boundedSubquery(table, timeColumn, `${expression} = {${p}:String}`),
        negated,
      );
    };
  }

  private crossTableNumericHandler(
    table: string,
    timeColumn: string,
    expression: string,
    name = "value",
  ): FieldHandler {
    return (tag, negated, ctx) => {
      if (tag.expression.type === "RangeExpression") {
        const min = tag.expression.range.min;
        const max = tag.expression.range.max;
        const pMin = this.values.nextParam(ctx, `${name}Min`);
        const pMax = this.values.nextParam(ctx, `${name}Max`);
        ctx.params[pMin] = min;
        ctx.params[pMax] = max;
        return this.values.wrap(
          this.subqueries.boundedSubquery(
            table,
            timeColumn,
            `${expression} >= {${pMin}:Float64} AND ${expression} <= {${pMax}:Float64}`,
          ),
          negated,
        );
      }
      const operator = tag.operator.operator;
      const num = this.values.extractNumericValue(tag);
      const p = this.values.nextParam(ctx, name);
      ctx.params[p] = num;
      const cmp = NUMERIC_OP_MAP[operator];
      if (!cmp) {
        throw new FilterParseError(`Unsupported operator: ${operator}`);
      }
      return this.values.wrap(
        this.subqueries.boundedSubquery(table, timeColumn, `${expression} ${cmp} {${p}:Float64}`),
        negated,
      );
    };
  }

  /**
   * Numeric comparison mirroring {@link translateNumericField}: inclusive
   * `[min TO max]` ranges (ClickHouse always emits `>=`/`<=`, ignoring liqe's
   * inclusivity flags) and the single-value operators.
   */
  private matchNumericInMemory(value: number, tag: TagToken): boolean {
    if (tag.expression.type === "RangeExpression") {
      const min = tag.expression.range.min;
      const max = tag.expression.range.max;
      return value >= min && value <= max;
    }
    const num = this.values.extractNumericValue(tag);
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

  private evaluateCategorical(
    read: CategoricalRead,
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ): boolean | Unsupported {
    const actual = read(trace);
    if (actual === UNSUPPORTED) return UNSUPPORTED;
    const target = this.values.extractStringValue(tag);
    // A `null` scalar mirrors a NULL ClickHouse column: `col = x` and
    // `NOT (col = x)` both yield NULL, i.e. the row is excluded either way.
    if (actual === null) return false;
    const values = Array.isArray(actual) ? actual : [actual];
    const matched = values.includes(target);
    return negated ? !matched : matched;
  }

  private evaluateRange(
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
    const matched = values.some((v) => this.matchNumericInMemory(v, tag));
    return negated ? !matched : matched;
  }

  /** Direct string equality on a `trace_summaries` expression. */
  categorical(expression: string, read: CategoricalRead, name?: string): FieldDef {
    return {
      toClickHouse: this.stringEqualityHandler(expression, name),
      evaluateInMemory: (tag, negated, trace) =>
        this.evaluateCategorical(read, tag, negated, trace),
    };
  }

  /** Numeric comparison on a `trace_summaries` expression. */
  range(expression: string, read: RangeRead, name?: string): FieldDef {
    return {
      toClickHouse: this.numericComparisonHandler(expression, name),
      evaluateInMemory: (tag, negated, trace) => this.evaluateRange(read, tag, negated, trace),
    };
  }

  /**
   * String equality answered by a partition-pruned subquery on another table
   * (`evaluation_runs` / `stored_spans`). `read` collects the candidate values
   * from the referenced collection (or {@link UNSUPPORTED} when it isn't loaded).
   */
  crossTableCategorical(
    table: string,
    timeColumn: string,
    expression: string,
    read: CategoricalRead,
    needs: FieldNeeds,
    name = "value",
  ): FieldDef {
    return {
      needs,
      toClickHouse: this.crossTableStringHandler(table, timeColumn, expression, name),
      evaluateInMemory: (tag, negated, trace) =>
        this.evaluateCategorical(read, tag, negated, trace),
    };
  }

  /** Numeric comparison answered by a partition-pruned cross-table subquery. */
  crossTableRange(
    table: string,
    timeColumn: string,
    expression: string,
    read: RangeRead,
    needs: FieldNeeds,
    name = "value",
  ): FieldDef {
    return {
      needs,
      toClickHouse: this.crossTableNumericHandler(table, timeColumn, expression, name),
      evaluateInMemory: (tag, negated, trace) => this.evaluateRange(read, tag, negated, trace),
    };
  }
}
