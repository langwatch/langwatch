/**
 * The functions a typed read may call (ADR-202, "The typed builder"), each typed by what it takes
 * and returns. The catalogue is the census of the repositories' SQL (rp-b2 handoff); a function
 * outside it is added here by review, never written as text.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import {
  argumentNode,
  type Binding,
  type Condition,
  type Direction,
  type Expression,
  type ExpressionNode,
  expression,
  type TablesOfExpression,
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
  const inner = /^Array\((.+)\)$/.exec(array.binding?.paramType ?? "")?.[1];
  return inner === undefined ? undefined : { paramType: inner };
}

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
  uniq: numeric("uniq", UINT64),
  uniqExact: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "uniqExact", args: [of.node], binding: UINT64 }),
  uniqExactIf: <T extends string, U extends string>(of: E<unknown, T>, when: Condition<U>) =>
    call<number, T | U>({ name: "uniqExactIf", args: [of.node, when.node], binding: UINT64 }),
  countDistinct: <T extends string>(of: E<unknown, T>) =>
    call<number, T>({ name: "countDistinct", args: [of.node], binding: UINT64 }),
  groupArray: <V, T extends string>(of: E<V, T>) =>
    call<readonly V[], T>({ name: "groupArray", args: [of.node], binding: undefined }),
  groupUniqArray: <V, T extends string>(of: E<V, T>) =>
    call<readonly V[], T>({ name: "groupUniqArray", args: [of.node], binding: undefined }),
  groupUniqArrayIf: <V, T extends string, U extends string>(of: E<V, T>, when: Condition<U>) =>
    call<readonly V[], T | U>({
      name: "groupUniqArrayIf",
      args: [of.node, when.node],
      binding: undefined,
    }),
  /** `quantile(level)(of)`: the level is a checked constant, as the grammar requires. */
  quantile: quantileOf("quantile"),
  quantileTDigest: quantileOf("quantileTDigest"),

  // Dates and times
  toUnixTimestamp64Milli: numeric("toUnixTimestamp64Milli", INT64),
  toUnixTimestamp: numeric("toUnixTimestamp", INT64),
  toDate: <T extends string>(of: E<Num, T>) =>
    call<string, T>({ name: "toDate", args: [of.node], binding: { paramType: "Date" } }),
  toStartOfDay: unary("toStartOfDay"),
  toStartOfHour: unary("toStartOfHour"),
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
  now: () => call<number, never>({ name: "now", args: [], binding: EPOCH_MS }),
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
  arrayDistinct: unary("arrayDistinct"),
  mapGet: <T extends string>(map: E<Readonly<Record<string, string>>, T>, key: string) =>
    expression<string, T>(
      {
        kind: "mapGet",
        map: map.node,
        key: { kind: "value", value: key, binding: STRING },
      },
      STRING,
    ),
  mapContains: <T extends string>(map: E<Readonly<Record<string, string>>, T>, key: string) =>
    call<boolean, T>({
      name: "mapContains",
      args: [map.node, { kind: "value", value: key, binding: STRING }],
      binding: BOOL,
    }),
  mapKeys: <T extends string>(map: E<Readonly<Record<string, string>>, T>) =>
    call<readonly string[], T>({
      name: "mapKeys",
      args: [map.node],
      binding: { paramType: "Array(String)" },
    }),
  mapValues: <T extends string>(map: E<Readonly<Record<string, string>>, T>) =>
    call<readonly string[], T>({
      name: "mapValues",
      args: [map.node],
      binding: { paramType: "Array(String)" },
    }),
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
