/**
 * The functions a typed read may call (ADR-202, "The typed builder"), each typed by what it takes
 * and returns. The catalogue is the census of the repositories' SQL (rp-b2 handoff); a function
 * outside it is added here by review, never written as text.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import {
  type AggregateState,
  argumentNode,
  type Binding,
  bindingOf,
  type ColumnRef,
  type ColumnType,
  type Condition,
  type Direction,
  type Expression,
  type ExpressionNode,
  expression,
  type TablesOfExpression,
  typeTextOf,
  unsupported,
  type ValueOfExpression,
} from "./expression.ts";
import { QueryBuilderError } from "./query-builder-error.ts";

type E<V, T extends string> = Expression<V, T>;
/** An argument: an expression, or a value bound the way the function's signature binds it. */
type Arg<V, T extends string> = E<V, T> | V;
type Num = number | null;

const STRING: Binding = { paramType: "String" };
const UINT64: Binding = { paramType: "UInt64" };
const INT64: Binding = { paramType: "Int64" };
const FLOAT64: Binding = { paramType: "Float64" };
const UINT32: Binding = { paramType: "UInt32" };
const BOOL: Binding = { paramType: "Bool" };
const EPOCH_MS: Binding = { paramType: "Int64", conversion: "fromUnixTimestamp64Milli" };
const STRINGS: Binding = { paramType: "Array(String)", element: STRING };

function call<V, T extends string>({
  name,
  args,
  binding,
  parameters = [],
}: {
  name: string;
  args: readonly ExpressionNode[];
  binding: Binding | undefined;
  parameters?: readonly number[];
}): E<V, T> {
  return expression<V, T>({ kind: "call", name, parameters, args }, binding);
}

const nodesOf = (values: readonly E<unknown, string>[]) => values.map((value) => value.node);

/** The element binding of an array expression, for a value tested against its members. */
function elementBinding(array: E<unknown, string>): Binding | undefined {
  if (array.binding?.element !== undefined) return array.binding.element;
  const inner = /^Array\((.+)\)$/.exec(array.binding?.paramType ?? "")?.[1];
  return inner === undefined ? undefined : { paramType: inner };
}

const arrayOf = (element: Binding | undefined): Binding | undefined =>
  element === undefined ? undefined : { paramType: `Array(${element.paramType})`, element };
const typeOfBinding = ({ paramType, conversion }: Binding) =>
  conversion === undefined ? paramType : `${conversion}(${paramType})`;

/** The binding an array literal's elements share; elements binding as two types are refused. */
function sharedBinding(items: readonly E<unknown, string>[]): Binding | undefined {
  if (items.length === 0) throw new QueryBuilderError({ kind: "empty-array" });
  const known = items.flatMap((item) => (item.binding === undefined ? [] : [item.binding]));
  const types = [...new Set(known.map(typeOfBinding))];
  if (types.length > 1) throw new QueryBuilderError({ kind: "mixed-array", types });
  return known[0];
}
const bound = (value: unknown, binding: Binding): ExpressionNode => ({
  kind: "value",
  value,
  binding,
});
/** A JSON path: each key bound as a String, each index as an Int64, an expression as itself. */
const jsonPath = (path: readonly Arg<string | number, string>[]) =>
  path.map((each) =>
    argumentNode({ value: each, binding: typeof each === "number" ? INT64 : STRING }),
  );

type Arr<V, T extends string> = E<readonly V[], T>;
type AnyArray = E<readonly unknown[], string>;
type ElementOf<A> = A extends E<readonly (infer V)[], string> ? V : never;
type LambdaParams<A extends readonly AnyArray[]> = { [K in keyof A]: E<ElementOf<A[K]>, never> };
type Dict<V> = Readonly<Record<string, V>>;
type Zipped<A extends readonly AnyArray[]> = readonly {
  readonly [K in keyof A]: ElementOf<A[K]>;
}[];

/** A lambda over `bindings`' parameters; its parameters exist only inside `body`. */
function lambdaOf({
  bindings,
  body,
}: {
  bindings: readonly (Binding | undefined)[];
  body: (...params: E<unknown, never>[]) => E<unknown, string>;
}): { node: ExpressionNode; binding: Binding | undefined } {
  const params: ExpressionNode[] = bindings.map(() => ({ kind: "lambdaParam" }));
  const result = body(...params.map((node, index) => expression<unknown>(node, bindings[index])));
  return { node: { kind: "lambda", params, body: result.node }, binding: result.binding };
}

/** `name(lambda, arrays…)`, the lambda taking one parameter per array. */
function arrayLambda<V>({
  name,
  arrays,
  body,
  binding,
}: {
  name: string;
  arrays: readonly AnyArray[];
  body: (...params: never) => E<unknown, string>;
  binding: (result: Binding | undefined) => Binding | undefined;
}) {
  const lambda = lambdaOf({
    bindings: arrays.map(elementBinding),
    body: body as (...params: E<unknown, never>[]) => E<unknown, string>,
  });
  return call<V, string>({
    name,
    args: [lambda.node, ...nodesOf(arrays)],
    binding: binding(lambda.binding),
  });
}

/** `<fn>Merge(state)`: the value an AggregateFunction column's stored state holds. */
const merge =
  <Fn extends string>(name: Fn) =>
  <V, T extends string>(of: E<AggregateState<Fn, V>, T>) =>
    call<V, T>({ name: `${name}Merge`, args: [of.node], binding: of.binding?.element });
const overArray =
  (name: string, binding?: Binding) =>
  <V extends Num, T extends string>(of: Arr<V, T>) =>
    call<V extends null ? number | null : number, T>({
      name,
      args: [of.node],
      binding: binding ?? elementBinding(of) ?? FLOAT64,
    });
const jsonRead =
  <V>(name: string, binding: Binding) =>
  <T extends string, U extends string = never>(
    of: E<string | null, T>,
    ...path: readonly Arg<string | number, U>[]
  ) =>
    call<V, T | U>({ name, args: [of.node, ...jsonPath(path)], binding });
const replace =
  (name: string) =>
  <T extends string, U extends string = never>(
    of: E<string | null, T>,
    pattern: Arg<string, U>,
    replacement: Arg<string, U>,
  ) =>
    call<string, T | U>({
      name,
      args: [
        of.node,
        argumentNode({ value: pattern, binding: STRING }),
        argumentNode({ value: replacement, binding: STRING }),
      ],
      binding: STRING,
    });
const groupLimit = (limit?: { max: number }) =>
  limit === undefined ? [] : [constant({ value: limit.max, min: 1, max: 1_000_000 })];
const timeZone = (zone: string | undefined) => (zone === undefined ? [] : [bound(zone, STRING)]);

/** The units `dateDiff` counts in. */
type DateUnit = "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

/** A constant the grammar needs as text: checked finite and inside its bounds first. */
function constant({ value, min, max }: { value: number; min: number; max: number }): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new QueryBuilderError({ kind: "bad-constant", value });
  }
  return value;
}

const unary =
  (name: string, binding?: Binding) =>
  <V, T extends string>(of: E<V, T>) =>
    call<V, T>({ name, args: [of.node], binding: binding ?? of.binding });
/** A rounding of a time in an optional time zone, the zone a bound String. */
const zoned =
  (name: string) =>
  <V, T extends string>(of: E<V, T>, { timeZone: zone }: { timeZone?: string } = {}) =>
    call<V, T>({ name, args: [of.node, ...timeZone(zone)], binding: of.binding });
const numeric =
  (name: string, binding: Binding = FLOAT64) =>
  <T extends string>(of: E<Num, T>) =>
    call<number, T>({ name, args: [of.node], binding });
const conditional =
  (name: string) =>
  <V, T extends string, U extends string>(of: E<V, T>, when: Condition<U>) =>
    call<V, T | U>({ name, args: [of.node, when.node], binding: of.binding });
const arithmetic =
  (name: string) =>
  <T extends string, U extends string = never>(left: E<Num, T>, right: Arg<Num, U>) =>
    call<number, T | U>({
      name,
      args: [left.node, argumentNode({ value: right, binding: left.binding ?? FLOAT64 })],
      binding: FLOAT64,
    });
const textTest =
  (name: string) =>
  <T extends string, U extends string = never>(of: E<string | null, T>, text: Arg<string, U>) =>
    call<boolean, T | U>({
      name,
      args: [of.node, argumentNode({ value: text, binding: STRING })],
      binding: BOOL,
    });
const quantileOf =
  (name: string) =>
  <T extends string>(level: number, of: E<Num, T>) =>
    call<number, T>({
      name,
      args: [of.node],
      binding: FLOAT64,
      parameters: [constant({ value: level, min: 0, max: 1 })],
    });

type Tuple<Items extends readonly E<unknown, string>[]> = {
  readonly [K in keyof Items]: ValueOfExpression<Items[K]>;
};
type Window = {
  partitionBy?: readonly E<unknown, string>[];
  orderBy?: readonly (readonly [E<unknown, string>, Direction])[];
};

/** The functions a selection, a condition, a grouping or an order may call. */
export const fn = {
  // Aggregates
  count: <T extends string = never>(of?: E<unknown, T>) =>
    call<number, T>({ name: "count", args: of === undefined ? [] : [of.node], binding: UINT64 }),
  countIf: <T extends string>(when: Condition<T>) =>
    call<number, T>({ name: "countIf", args: [when.node], binding: UINT64 }),
  sum: numeric("sum"),
  sumIf: <T extends string, U extends string>(of: E<Num, T>, when: Condition<U>) =>
    call<number, T | U>({ name: "sumIf", args: [of.node, when.node], binding: FLOAT64 }),
  sumOrNull: <T extends string>(of: E<Num, T>) =>
    call<number | null, T>({ name: "sumOrNull", args: [of.node], binding: FLOAT64 }),
  avg: numeric("avg"),
  avgIf: <T extends string, U extends string>(of: E<Num, T>, when: Condition<U>) =>
    call<number, T | U>({ name: "avgIf", args: [of.node, when.node], binding: FLOAT64 }),
  max: unary("max"),
  min: unary("min"),
  any: unary("any"),
  maxIf: conditional("maxIf"),
  minIf: conditional("minIf"),
  anyIf: conditional("anyIf"),
  argMax: <V, T extends string, U extends string>(value: E<V, T>, by: E<unknown, U>) =>
    call<V, T | U>({ name: "argMax", args: [value.node, by.node], binding: value.binding }),
  argMin: <V, T extends string, U extends string>(value: E<V, T>, by: E<unknown, U>) =>
    call<V, T | U>({ name: "argMin", args: [value.node, by.node], binding: value.binding }),
  argMaxIf: <V, T extends string, U extends string, W extends string>(
    value: E<V, T>,
    by: E<unknown, U>,
    when: Condition<W>,
  ) =>
    call<V, T | U | W>({
      name: "argMaxIf",
      args: [value.node, by.node, when.node],
      binding: value.binding,
    }),
  /** `uniq(a, b, …)`: the approximate count of distinct values, or of distinct tuples of them. */
  uniq: <const Of extends readonly [E<unknown, string>, ...E<unknown, string>[]]>(...of: Of) =>
    call<number, TablesOfExpression<Of[number]>>({
      name: "uniq",
      args: nodesOf(of),
      binding: UINT64,
    }),
  uniqExact: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "uniqExact", args: [of.node], binding: UINT64 }),
  uniqExactIf: <T extends string, U extends string>(of: E<unknown, T>, when: Condition<U>) =>
    call<number, T | U>({ name: "uniqExactIf", args: [of.node, when.node], binding: UINT64 }),
  countDistinct: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "countDistinct", args: [of.node], binding: UINT64 }),
  /** `limit` caps the array (`groupArray(max)(of)`), a checked constant. */
  groupArray: <V, T extends string>(of: E<V, T>, limit?: { max: number }) =>
    call<readonly V[], T>({
      name: "groupArray",
      args: [of.node],
      binding: arrayOf(of.binding),
      parameters: groupLimit(limit),
    }),
  groupUniqArray: <V, T extends string>(of: E<V, T>, limit?: { max: number }) =>
    call<readonly V[], T>({
      name: "groupUniqArray",
      args: [of.node],
      binding: arrayOf(of.binding),
      parameters: groupLimit(limit),
    }),
  groupUniqArrayIf: <V, T extends string, U extends string>(
    of: E<V, T>,
    when: Condition<U>,
    limit?: { max: number },
  ) =>
    call<readonly V[], T | U>({
      name: "groupUniqArrayIf",
      args: [of.node, when.node],
      binding: arrayOf(of.binding),
      parameters: groupLimit(limit),
    }),
  groupUniqArrayArray: <V, T extends string>(of: Arr<V, T>, limit?: { max: number }) =>
    call<readonly V[], T>({
      name: "groupUniqArrayArray",
      args: [of.node],
      binding: of.binding,
      parameters: groupLimit(limit),
    }),
  /** `topKArray(k)(of)`: the k most frequent members across the arrays. */
  topKArray: <V, T extends string>(k: number, of: Arr<V, T>) =>
    call<readonly V[], T>({
      name: "topKArray",
      args: [of.node],
      binding: of.binding,
      parameters: [constant({ value: k, min: 1, max: 1_000 })],
    }),
  uniqIf: <T extends string, U extends string>(of: E<unknown, T>, when: Condition<U>) =>
    call<number, T | U>({ name: "uniqIf", args: [of.node, when.node], binding: UINT64 }),
  /** `uniqUpTo(n)(of)`: the distinct count, exact up to `n`, `n + 1` past it. */
  uniqUpTo: <T extends string>(n: number, of: E<unknown, T>) =>
    call<number, T>({
      name: "uniqUpTo",
      args: [of.node],
      binding: UINT64,
      parameters: [constant({ value: n, min: 1, max: 100 })],
    }),
  argMinIf: <V, T extends string, U extends string, W extends string>(
    value: E<V, T>,
    by: E<unknown, U>,
    when: Condition<W>,
  ) =>
    call<V, T | U | W>({
      name: "argMinIf",
      args: [value.node, by.node, when.node],
      binding: value.binding,
    }),
  quantileExactIf: <T extends string, U extends string>(
    level: number,
    of: E<Num, T>,
    when: Condition<U>,
  ) =>
    call<number, T | U>({
      name: "quantileExactIf",
      args: [of.node, when.node],
      binding: FLOAT64,
      parameters: [constant({ value: level, min: 0, max: 1 })],
    }),
  quantileTDigestIf: <T extends string, U extends string>(
    level: number,
    of: E<Num, T>,
    when: Condition<U>,
  ) =>
    call<number, T | U>({
      name: "quantileTDigestIf",
      args: [of.node, when.node],
      binding: FLOAT64,
      parameters: [constant({ value: level, min: 0, max: 1 })],
    }),
  sumArray: overArray("sumArray", FLOAT64),
  avgArray: overArray("avgArray", FLOAT64),
  minArray: overArray("minArray"),
  maxArray: overArray("maxArray"),
  uniqArray: <T extends string>(of: Arr<unknown, T>) =>
    call<number, T>({ name: "uniqArray", args: [of.node], binding: UINT64 }),
  /** `sumMap(keys, values)`: per key, the sum of its values, as a `(keys, sums)` tuple. */
  sumMap: <K, T extends string, U extends string>(keys: Arr<K, T>, values: Arr<Num, U>) =>
    call<readonly [readonly K[], readonly number[]], T | U>({
      name: "sumMap",
      args: [keys.node, values.node],
      binding: undefined,
    }),

  // AggregateFunction states, read through their -Merge function
  sumMerge: merge("sum"),
  countMerge: merge("count"),
  maxMerge: merge("max"),
  minMerge: merge("min"),
  anyMerge: merge("any"),
  argMaxMerge: merge("argMax"),
  argMinMerge: merge("argMin"),
  avgMerge: merge("avg"),
  uniqMerge: merge("uniq"),
  /** `quantile(level)(of)`: the level is a checked constant, as the grammar requires. */
  quantile: quantileOf("quantile"),
  quantileTDigest: quantileOf("quantileTDigest"),

  // Dates and times
  toUnixTimestamp64Milli: numeric("toUnixTimestamp64Milli", INT64),
  /** Epoch milliseconds as a DateTime64(3): a value compared with it binds as epoch ms. */
  fromUnixTimestamp64Milli: numeric("fromUnixTimestamp64Milli", EPOCH_MS),
  toUnixTimestamp: numeric("toUnixTimestamp", INT64),
  toDate: <T extends string>(of: E<Num, T>) =>
    call<string, T>({ name: "toDate", args: [of.node], binding: { paramType: "Date" } }),
  toStartOfDay: zoned("toStartOfDay"),
  toStartOfHour: zoned("toStartOfHour"),
  /** `toStartOfInterval(of, toIntervalSecond(seconds))`, the width bound as a parameter. */
  toStartOfInterval: <T extends string>(of: E<Num, T>, { seconds }: { seconds: number }) =>
    call<number, T>({
      name: "toStartOfInterval",
      args: [
        of.node,
        {
          kind: "call",
          name: "toIntervalSecond",
          parameters: [],
          args: [{ kind: "value", value: seconds, binding: UINT32 }],
        },
      ],
      binding: of.binding,
    }),
  toStartOfMinute: unary("toStartOfMinute"),
  /** `mode` is the week's first day and range (0: Sunday, 1: Monday), a checked constant. */
  toStartOfWeek: <T extends string>(
    of: E<Num, T>,
    { mode = 0, timeZone: zone }: { mode?: number; timeZone?: string } = {},
  ) =>
    call<number, T>({
      name: "toStartOfWeek",
      args: [
        of.node,
        { kind: "literal", value: constant({ value: mode, min: 0, max: 9 }) },
        ...timeZone(zone),
      ],
      binding: of.binding,
    }),
  toStartOfMonth: <T extends string>(
    of: E<Num, T>,
    { timeZone: zone }: { timeZone?: string } = {},
  ) =>
    call<number, T>({
      name: "toStartOfMonth",
      args: [of.node, ...timeZone(zone)],
      binding: of.binding,
    }),
  toDateTime64: <T extends string>(of: E<unknown, T>, precision: number) =>
    call<number, T>({
      name: "toDateTime64",
      args: [of.node, { kind: "literal", value: constant({ value: precision, min: 0, max: 9 }) }],
      binding: EPOCH_MS,
    }),
  formatDateTime: <T extends string>(of: E<Num, T>, format: string, zone?: string) =>
    call<string, T>({
      name: "formatDateTime",
      args: [of.node, bound(format, STRING), ...timeZone(zone)],
      binding: STRING,
    }),
  dateDiff: <T extends string, U extends string>(unit: DateUnit, from: E<Num, T>, to: E<Num, U>) =>
    call<number, T | U>({
      name: "dateDiff",
      args: [bound(unit, STRING), from.node, to.node],
      binding: INT64,
    }),
  now: () => call<number, never>({ name: "now", args: [], binding: EPOCH_MS }),
  now64: (precision = 3) =>
    call<number, never>({
      name: "now64",
      args: [{ kind: "literal", value: constant({ value: precision, min: 0, max: 9 }) }],
      binding: EPOCH_MS,
    }),
  currentDatabase: () =>
    call<string, never>({ name: "currentDatabase", args: [], binding: STRING }),

  // Nulls and branches
  coalesce: <V, T extends string>(...of: readonly E<V, T>[]) =>
    call<V, T>({ name: "coalesce", args: nodesOf(of), binding: of[0]?.binding }),
  ifNull: <V, T extends string, U extends string = never>(
    of: E<V | null, T>,
    otherwise: Arg<V, U>,
  ) =>
    call<V, T | U>({
      name: "ifNull",
      args: [of.node, argumentNode({ value: otherwise, binding: of.binding })],
      binding: of.binding,
    }),
  nullIf: <V, T extends string, U extends string = never>(of: E<V, T>, equal: Arg<V, U>) =>
    call<V | null, T | U>({
      name: "nullIf",
      args: [of.node, argumentNode({ value: equal, binding: of.binding })],
      binding: of.binding,
    }),
  assumeNotNull: <V, T extends string>(of: E<V, T>) =>
    call<NonNullable<V>, T>({ name: "assumeNotNull", args: [of.node], binding: of.binding }),
  toNullable: <V, T extends string>(of: E<V, T>) =>
    call<V | null, T>({ name: "toNullable", args: [of.node], binding: of.binding }),
  if: <V, C extends string, T extends string, U extends string = never>(
    when: Condition<C>,
    then: E<V, T>,
    otherwise: Arg<V, U>,
  ) =>
    call<V, C | T | U>({
      name: "if",
      args: [when.node, then.node, argumentNode({ value: otherwise, binding: then.binding })],
      binding: then.binding,
    }),
  /** `multiIf(c1, v1, c2, v2, …, otherwise)`, the CASE of ClickHouse. */
  multiIf: <V, T extends string>(
    branches: readonly (readonly [Condition<T>, E<V, T>])[],
    otherwise: E<V, T>,
  ) =>
    call<V, T>({
      name: "multiIf",
      args: [...branches.flatMap(([when, then]) => [when.node, then.node]), otherwise.node],
      binding: otherwise.binding,
    }),

  // Strings
  toString: <T extends string>(of: E<unknown, T>) =>
    call<string, T>({ name: "toString", args: [of.node], binding: STRING }),
  lower: unary("lower", STRING),
  lowerUTF8: unary("lowerUTF8", STRING),
  upper: unary("upper", STRING),
  trim: unary("trim", STRING),
  length: <T extends string>(of: E<string | readonly unknown[] | null, T>) =>
    call<number, T>({ name: "length", args: [of.node], binding: UINT64 }),
  empty: <T extends string>(of: E<unknown, T>) =>
    call<boolean, T>({ name: "empty", args: [of.node], binding: BOOL }),
  notEmpty: <T extends string>(of: E<unknown, T>) =>
    call<boolean, T>({ name: "notEmpty", args: [of.node], binding: BOOL }),
  startsWith: textTest("startsWith"),
  endsWith: textTest("endsWith"),
  like: textTest("like"),
  ilike: textTest("ilike"),
  notLike: textTest("notLike"),
  concat: <U extends string = never>(...parts: readonly Arg<string | null, U>[]) =>
    call<string, U>({
      name: "concat",
      args: parts.map((part) => argumentNode({ value: part, binding: STRING })),
      binding: STRING,
    }),
  replaceOne: replace("replaceOne"),
  replaceAll: replace("replaceAll"),
  replaceRegexpAll: replace("replaceRegexpAll"),
  /** `trim(BOTH chars FROM of)`: `chars` stripped from both ends. */
  trimBoth: <T extends string, U extends string = never>(
    of: E<string | null, T>,
    chars: Arg<string, U>,
  ) =>
    expression<string, T | U>(
      { kind: "trim", term: of.node, chars: argumentNode({ value: chars, binding: STRING }) },
      STRING,
    ),
  extractAll: <T extends string, U extends string = never>(
    of: E<string | null, T>,
    pattern: Arg<string, U>,
  ) =>
    call<readonly string[], T | U>({
      name: "extractAll",
      args: [of.node, argumentNode({ value: pattern, binding: STRING })],
      binding: STRINGS,
    }),
  /** `char(codes…)`: the bytes, each bound as a UInt8. */
  char: (...codes: readonly number[]) =>
    call<string, never>({
      name: "char",
      args: codes.map((code) => bound(code, { paramType: "UInt8" })),
      binding: STRING,
    }),
  arrayStringConcat: <T extends string, U extends string = never>(
    of: Arr<string, T>,
    separator: Arg<string, U>,
  ) =>
    call<string, T | U>({
      name: "arrayStringConcat",
      args: [of.node, argumentNode({ value: separator, binding: STRING })],
      binding: STRING,
    }),
  positionCaseInsensitive: <T extends string, U extends string = never>(
    of: E<string | null, T>,
    needle: Arg<string, U>,
  ) =>
    call<number, T | U>({
      name: "positionCaseInsensitive",
      args: [of.node, argumentNode({ value: needle, binding: STRING })],
      binding: UINT64,
    }),

  // JSON, each key of the path bound as a value or given as an expression (a lambda's parameter)
  JSONExtractString: jsonRead<string>("JSONExtractString", STRING),
  JSONExtractRaw: jsonRead<string>("JSONExtractRaw", STRING),
  JSONExtractFloat: jsonRead<number>("JSONExtractFloat", FLOAT64),
  JSONExtractArrayRaw: jsonRead<readonly string[]>("JSONExtractArrayRaw", STRINGS),
  JSONExtractKeys: jsonRead<readonly string[]>("JSONExtractKeys", STRINGS),
  /** `JSONExtract(of, path…, type)`: the type checked against the type grammar, then bound. */
  JSONExtract: <V, T extends string, U extends string = never>(
    of: E<string | null, T>,
    type: ColumnType<V>,
    ...path: readonly Arg<string | number, U>[]
  ) =>
    call<V, T | U>({
      name: "JSONExtract",
      args: [of.node, ...jsonPath(path), bound(typeTextOf(type), STRING)],
      binding: bindingOf(type),
    }),

  // Casts: the type is a column type, its text checked against the type grammar
  cast: <V, T extends string>(of: E<unknown, T>, type: ColumnType<V>) =>
    expression<V, T>({ kind: "cast", term: of.node, type: typeTextOf(type) }, bindingOf(type)),
  /** `CAST(NULL AS Nullable(…))`: a typed NULL, for a value a row does not hold. */
  nullAs: <V>(type: ColumnType<V | null>) => {
    if (!/^(LowCardinality\()?Nullable\(/.test(type.clickhouse)) {
      throw new QueryBuilderError({ kind: "unsupported-operand", column: type.clickhouse });
    }
    return expression<V | null, never>(
      { kind: "cast", term: { kind: "constant", text: "NULL" }, type: typeTextOf(type) },
      bindingOf(type),
    );
  },
  /** `CAST([] AS Array(…))`: a typed empty array. */
  emptyArrayAs: <V>(type: ColumnType<readonly V[]>) => {
    if (!type.clickhouse.startsWith("Array(")) {
      throw new QueryBuilderError({ kind: "unsupported-operand", column: type.clickhouse });
    }
    return expression<readonly V[], never>(
      { kind: "cast", term: { kind: "constant", text: "[]" }, type: typeTextOf(type) },
      bindingOf(type),
    );
  },
  /**
   * The column where the target holds it, else `otherwise` (NO-HOLDS): `holds` answers for the
   * table's stored column names, as the client's column list does.
   */
  heldOr: <V, T extends string, U extends string = never>(
    of: ColumnRef<T, string, V>,
    { holds, otherwise }: { holds: (name: string) => boolean; otherwise: E<V, U> },
  ): E<V, T | U> => (holds(of.name) ? of : otherwise),

  position: <T extends string, U extends string = never>(
    of: E<string, T>,
    needle: Arg<string, U>,
  ) =>
    call<number, T | U>({
      name: "position",
      args: [of.node, argumentNode({ value: needle, binding: STRING })],
      binding: UINT64,
    }),

  // Numbers
  plus: arithmetic("plus"),
  minus: arithmetic("minus"),
  multiply: arithmetic("multiply"),
  divide: arithmetic("divide"),
  intDiv: arithmetic("intDiv"),
  greatest: <V, T extends string>(...of: readonly E<V, T>[]) =>
    call<V, T>({ name: "greatest", args: nodesOf(of), binding: of[0]?.binding }),
  least: <V, T extends string>(...of: readonly E<V, T>[]) =>
    call<V, T>({ name: "least", args: nodesOf(of), binding: of[0]?.binding }),
  round: <T extends string>(of: E<Num, T>, digits = 0) =>
    call<number, T>({
      name: "round",
      args: [of.node, { kind: "literal", value: constant({ value: digits, min: 0, max: 18 }) }],
      binding: FLOAT64,
    }),
  toInt64: numeric("toInt64", INT64),
  toUInt64: numeric("toUInt64", UINT64),
  toUInt32: numeric("toUInt32", UINT32),
  toUInt16: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "toUInt16", args: [of.node], binding: { paramType: "UInt16" } }),
  toInt32OrNull: <T extends string>(of: E<string | null, T>) =>
    call<number | null, T>({
      name: "toInt32OrNull",
      args: [of.node],
      binding: { paramType: "Int32" },
    }),
  toFloat64OrZero: <T extends string>(of: E<string | null, T>) =>
    call<number, T>({ name: "toFloat64OrZero", args: [of.node], binding: FLOAT64 }),
  cityHash64: <T extends string>(...of: readonly E<unknown, T>[]) =>
    call<number, T>({ name: "cityHash64", args: nodesOf(of), binding: UINT64 }),
  toUInt8: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "toUInt8", args: [of.node], binding: { paramType: "UInt8" } }),
  toFloat64: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "toFloat64", args: [of.node], binding: FLOAT64 }),
  toFloat64OrNull: <T extends string>(of: E<string | null, T>) =>
    call<number | null, T>({ name: "toFloat64OrNull", args: [of.node], binding: FLOAT64 }),
  toUInt64OrZero: <T extends string>(of: E<string | null, T>) =>
    call<number, T>({ name: "toUInt64OrZero", args: [of.node], binding: UINT64 }),
  sipHash64: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "sipHash64", args: [of.node], binding: UINT64 }),

  // Arrays, maps and tuples
  has: <V, T extends string, U extends string = never>(of: E<readonly V[], T>, member: Arg<V, U>) =>
    call<boolean, T | U>({
      name: "has",
      args: [of.node, argumentNode({ value: member, binding: elementBinding(of) })],
      binding: BOOL,
    }),
  hasAny: <V, T extends string, U extends string = never>(
    of: E<readonly V[], T>,
    members: Arg<readonly V[], U>,
  ) =>
    call<boolean, T | U>({
      name: "hasAny",
      args: [of.node, argumentNode({ value: members, binding: of.binding })],
      binding: BOOL,
    }),
  indexOf: <V, T extends string, U extends string = never>(
    of: E<readonly V[], T>,
    member: Arg<V, U>,
  ) =>
    call<number, T | U>({
      name: "indexOf",
      args: [of.node, argumentNode({ value: member, binding: elementBinding(of) })],
      binding: UINT64,
    }),
  arrayElement: <V, T extends string>(of: E<readonly V[], T>, index: number) =>
    call<V, T>({
      name: "arrayElement",
      args: [of.node, { kind: "value", value: index, binding: INT64 }],
      binding: elementBinding(of),
    }),
  arrayJoin: <V, T extends string>(of: E<readonly V[], T>) =>
    call<V, T>({ name: "arrayJoin", args: [of.node], binding: elementBinding(of) }),
  arraySort: unary("arraySort"),
  arrayReverseSort: unary("arrayReverseSort"),
  arrayDistinct: unary("arrayDistinct"),
  /** `arraySlice(of, offset, length)`: 1-based `offset`, both bound as Int64. */
  arraySlice: <V, T extends string>(of: Arr<V, T>, offset: number, length?: number) =>
    call<readonly V[], T>({
      name: "arraySlice",
      args: [
        of.node,
        bound(offset, INT64),
        ...(length === undefined ? [] : [bound(length, INT64)]),
      ],
      binding: of.binding,
    }),
  /** `array(e1, e2, …)`, ClickHouse's spelling of `[e1, e2, …]`: one element type for all. */
  array: <V, T extends string = never>(...items: readonly E<V, T>[]) =>
    call<readonly V[], T>({
      name: "array",
      args: nodesOf(items),
      binding: arrayOf(sharedBinding(items)),
    }),
  arrayZip: <const A extends readonly [AnyArray, ...AnyArray[]]>(...arrays: A) =>
    call<Zipped<A>, TablesOfExpression<A[number]>>({
      name: "arrayZip",
      args: nodesOf(arrays),
      binding: undefined,
    }),
  arrayEnumerate: <T extends string>(of: Arr<unknown, T>) =>
    call<readonly number[], T>({
      name: "arrayEnumerate",
      args: [of.node],
      binding: arrayOf(UINT32),
    }),
  arraySum: <T extends string>(of: Arr<Num, T>) =>
    call<number, T>({ name: "arraySum", args: [of.node], binding: FLOAT64 }),
  hasAll: <V, T extends string, U extends string = never>(
    of: Arr<V, T>,
    members: Arg<readonly V[], U>,
  ) =>
    call<boolean, T | U>({
      name: "hasAll",
      args: [of.node, argumentNode({ value: members, binding: of.binding })],
      binding: BOOL,
    }),
  /** `arrayMap(x -> body, arrays…)`: `body` gets one typed parameter per array. */
  arrayMap: <const A extends readonly [AnyArray, ...AnyArray[]], R, U extends string = never>(
    body: (...params: LambdaParams<A>) => E<R, U>,
    ...arrays: A
  ) =>
    arrayLambda<readonly R[]>({ name: "arrayMap", arrays, body, binding: arrayOf }) as E<
      readonly R[],
      U | TablesOfExpression<A[number]>
    >,
  arrayFilter: <const A extends readonly [AnyArray, ...AnyArray[]], U extends string = never>(
    body: (...params: LambdaParams<A>) => Condition<U>,
    ...arrays: A
  ) =>
    arrayLambda<ValueOfExpression<A[0]>>({
      name: "arrayFilter",
      arrays,
      body,
      binding: () => arrays[0].binding,
    }) as E<ValueOfExpression<A[0]>, U | TablesOfExpression<A[number]>>,
  arrayExists: <const A extends readonly [AnyArray, ...AnyArray[]], U extends string = never>(
    body: (...params: LambdaParams<A>) => Condition<U>,
    ...arrays: A
  ) =>
    arrayLambda<boolean>({ name: "arrayExists", arrays, body, binding: () => BOOL }) as E<
      boolean,
      U | TablesOfExpression<A[number]>
    >,
  /** `arraySort(x -> key, of)`: ordered by the key the lambda computes. */
  arraySortBy: <V, T extends string, U extends string = never>(
    key: (member: E<V, never>) => E<unknown, U>,
    of: Arr<V, T>,
  ) =>
    arrayLambda<readonly V[]>({
      name: "arraySort",
      arrays: [of],
      body: key,
      binding: () => of.binding,
    }) as E<readonly V[], T | U>,
  arrayReverseSortBy: <V, T extends string, U extends string = never>(
    key: (member: E<V, never>) => E<unknown, U>,
    of: Arr<V, T>,
  ) =>
    arrayLambda<readonly V[]>({
      name: "arrayReverseSort",
      arrays: [of],
      body: key,
      binding: () => of.binding,
    }) as E<readonly V[], T | U>,
  mapGet: <V, T extends string>(map: E<Dict<V>, T>, key: string) =>
    expression<V, T>(
      { kind: "mapGet", map: map.node, key: bound(key, STRING) },
      map.binding?.element ?? STRING,
    ),
  mapContains: <T extends string>(map: E<Dict<unknown>, T>, key: string) =>
    call<boolean, T>({ name: "mapContains", args: [map.node, bound(key, STRING)], binding: BOOL }),
  mapKeys: <T extends string>(map: E<Dict<unknown>, T>) =>
    call<readonly string[], T>({ name: "mapKeys", args: [map.node], binding: STRINGS }),
  mapValues: <V, T extends string>(map: E<Dict<V>, T>) =>
    call<readonly V[], T>({
      name: "mapValues",
      args: [map.node],
      binding: arrayOf(map.binding?.element ?? STRING),
    }),
  mapFromArrays: <V, T extends string, U extends string>(
    keys: Arr<string, T>,
    values: Arr<V, U>,
  ) => {
    const element = elementBinding(values) ?? STRING;
    return call<Dict<V>, T | U>({
      name: "mapFromArrays",
      args: [keys.node, values.node],
      binding: { paramType: `Map(String, ${element.paramType})`, element },
    });
  },
  /** `map(key, value, …)`: each key bound as a String. */
  map: <V, T extends string>(...entries: readonly (readonly [string, E<V, T>])[]) =>
    call<Dict<V>, T>({
      name: "map",
      args: entries.flatMap(([key, value]) => [bound(key, STRING), value.node]),
      binding: arrayOf(entries[0]?.[1].binding),
    }),
  /** `mapFilter((k, v) -> condition, of)`: the entries the condition keeps. */
  mapFilter: <V, T extends string, U extends string = never>(
    keep: (key: E<string, never>, value: E<V, never>) => Condition<U>,
    of: E<Dict<V>, T>,
  ) => {
    const lambda = lambdaOf({
      bindings: [STRING, of.binding?.element],
      body: keep as (...params: E<unknown, never>[]) => E<unknown, string>,
    });
    return call<Dict<V>, T | U>({
      name: "mapFilter",
      args: [lambda.node, of.node],
      binding: of.binding,
    });
  },
  /** A tuple, for a keyset comparison such as `(EventTime, EventId) > (…)` or an argMax row. */
  tuple: <const Items extends readonly E<unknown, string>[]>(...items: Items) =>
    call<Tuple<Items>, TablesOfExpression<Items[number]>>({
      name: "tuple",
      args: nodesOf(items),
      binding: undefined,
    }),
  /** `tupleElement(of, index)`: `index` is the TypeScript tuple's, 0-based; the text is 1-based. */
  tupleElement: <
    Items extends readonly unknown[],
    T extends string,
    Index extends Extract<keyof Items, `${number}`>,
  >(
    of: E<Items, T>,
    index: Index,
  ) => {
    const position = constant({ value: Number(index), min: 0, max: 1024 }) + 1;
    if (!Number.isSafeInteger(position)) throw unsupported(of.node);
    return call<Items[Index], T>({
      name: "tupleElement",
      args: [of.node, { kind: "literal", value: position }],
      binding: undefined,
    });
  },

  // Windows
  rowNumber: () => call<number, never>({ name: "row_number", args: [], binding: UINT64 }),
  /** `<call> OVER (PARTITION BY … ORDER BY …)`; a window holds its whole input in memory. */
  over: <V, T extends string>(of: E<V, T>, { partitionBy = [], orderBy = [] }: Window) =>
    expression<V, T>(
      {
        kind: "over",
        call: of.node,
        partitionBy: nodesOf(partitionBy),
        orderBy: orderBy.map(([each, direction]) => ({ node: each.node, direction })),
      },
      of.binding,
    ),
} as const;
