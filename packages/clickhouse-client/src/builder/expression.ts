/**
 * The expressions a typed read is built from: columns, bound values, calls and comparisons. A
 * value reaches the text only as a named parameter; the one text escape is a reviewed fragment.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { QueryBuilderError } from "./query-builder-error.ts";
import { REVIEWED_FRAGMENTS, type ReviewedFragmentId } from "./reviewed-fragments.ts";

declare const valueBrand: unique symbol;
declare const tablesBrand: unique symbol;
const EXPRESSION = Symbol("clickhouse.expression");

/** The one conversion a bound value passes through: epoch milliseconds into a DateTime64. */
type Conversion = "fromUnixTimestamp64Milli";

/**
 * How a value compared with an expression is bound: its parameter type and any conversion, and
 * for an array or a map the binding of a member it holds.
 */
export type Binding = {
  readonly paramType: string;
  readonly conversion?: Conversion;
  readonly element?: Binding;
};

/** A column's declared ClickHouse type, carrying the TypeScript value a bound value of it takes. */
export type ColumnType<Value> = Binding & {
  readonly clickhouse: string;
  readonly [valueBrand]?: Value;
};

const columnType = <Value>(spec: Binding & { clickhouse: string }): ColumnType<Value> => spec;
const plain = <Value>(clickhouse: string) =>
  columnType<Value>({ clickhouse, paramType: clickhouse });

/** A type's binding without its ClickHouse text. */
export function bindingOf(type: Binding): Binding {
  return {
    paramType: type.paramType,
    ...(type.conversion === undefined ? {} : { conversion: type.conversion }),
    ...(type.element === undefined ? {} : { element: bindingOf(type.element) }),
  };
}

declare const stateBrand: unique symbol;
/** An AggregateFunction column's stored state: read only through its `-Merge` function. */
export type AggregateState<Fn extends string, Result> = {
  readonly [stateBrand]: { readonly fn: Fn; readonly result: Result };
};
const STATE_FUNCTIONS = ["sum", "count", "max", "min", "any", "argMax", "argMin", "avg", "uniq"];
type StateFunction = "sum" | "count" | "max" | "min" | "any" | "argMax" | "argMin" | "avg" | "uniq";
const SIMPLE_FUNCTIONS = ["sum", "max", "min", "any", "anyLast"];
type SimpleFunction = "sum" | "max" | "min" | "any" | "anyLast";
/** The result binding of a state whose value is a count or a mean, not its argument's type. */
const COUNTED_RESULTS: Readonly<Partial<Record<string, Binding>>> = {
  count: { paramType: "UInt64" },
  uniq: { paramType: "UInt64" },
  avg: { paramType: "Float64" },
};
type ValueOfType<C> = C extends ColumnType<infer Value> ? Value : never;
type StateResult<Fn, Args> = Fn extends "count" | "uniq" | "avg"
  ? number
  : Args extends readonly [infer First, ...unknown[]]
    ? ValueOfType<First>
    : never;

function checkedInteger({ value, min, max }: { value: number; min: number; max: number }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new QueryBuilderError({ kind: "bad-constant", value });
  }
  return value;
}

/**
 * A type's ClickHouse text, checked against the type grammar (`Name`, `Name(arg, …)`, each arg a
 * type or an integer), so a type written as text by a CAST carries nothing else.
 */
export function typeTextOf(type: { readonly clickhouse: string }): string {
  const tokens = type.clickhouse.match(/[A-Za-z_][A-Za-z0-9_]*|\d+|[(),]|\s+|./g) ?? [];
  const words = tokens.filter((token) => !/^\s+$/.test(token));
  let at = 0;
  const parse = (): boolean => {
    const word = words[at];
    if (word === undefined || !/^([A-Za-z_][A-Za-z0-9_]*|\d+)$/.test(word)) return false;
    at += 1;
    if (words[at] !== "(") return true;
    if (/^\d/.test(word)) return false;
    do at += 1;
    while (parse() && words[at] === ",");
    if (words[at] !== ")") return false;
    at += 1;
    return true;
  };
  if (!parse() || at !== words.length || /^\d/.test(words[0] ?? "")) {
    throw new QueryBuilderError({ kind: "unsupported-operand", column: type.clickhouse });
  }
  return type.clickhouse;
}

/** The column types a table descriptor declares. A DateTime64 or DateTime binds epoch ms. */
export const column = {
  string: () => plain<string>("String"),
  lowCardinalityString: () =>
    columnType<string>({ clickhouse: "LowCardinality(String)", paramType: "String" }),
  bool: () => plain<boolean>("Bool"),
  int8: () => plain<number>("Int8"),
  uint8: () => plain<number>("UInt8"),
  uint16: () => plain<number>("UInt16"),
  uint32: () => plain<number>("UInt32"),
  uint64: () => plain<number>("UInt64"),
  int32: () => plain<number>("Int32"),
  int64: () => plain<number>("Int64"),
  float64: () => plain<number>("Float64"),
  date: () => plain<string>("Date"),
  dateTime64: ({ precision }: { precision: 3 | 6 | 9 }) =>
    columnType<number>({
      clickhouse: `DateTime64(${precision})`,
      paramType: "Int64",
      conversion: "fromUnixTimestamp64Milli",
    }),
  dateTime: () =>
    columnType<number>({
      clickhouse: "DateTime",
      paramType: "Int64",
      conversion: "fromUnixTimestamp64Milli",
    }),
  fixedString: ({ length }: { length: number }) =>
    columnType<string>({
      clickhouse: `FixedString(${checkedInteger({ value: length, min: 1, max: 65_535 })})`,
      paramType: "String",
    }),
  decimal: ({ precision, scale }: { precision: number; scale: number }) => {
    const p = checkedInteger({ value: precision, min: 1, max: 76 });
    return plain<number>(`Decimal(${p}, ${checkedInteger({ value: scale, min: 0, max: p })})`);
  },
  stringMap: () => column.map({ key: column.string(), value: column.string() }),
  stringArray: () => column.array(column.string()),
  int64Array: () => column.array(column.int64()),
  /** A Nullable column binds a compared value as its inner type does. */
  nullable: <Value>(inner: ColumnType<Value>): ColumnType<Value | null> =>
    columnType<Value | null>({ ...bindingOf(inner), clickhouse: `Nullable(${inner.clickhouse})` }),
  /** LowCardinality changes storage, not values: it binds as its inner type does. */
  lowCardinality: <Value>(inner: ColumnType<Value>): ColumnType<Value> =>
    columnType<Value>({ ...bindingOf(inner), clickhouse: `LowCardinality(${inner.clickhouse})` }),
  /** An array, nested columns included: a member tested against it binds as `of` does. */
  array: <Value>(of: ColumnType<Value>): ColumnType<readonly Value[]> =>
    columnType<readonly Value[]>({
      clickhouse: `Array(${of.clickhouse})`,
      paramType: `Array(${of.paramType})`,
      element: bindingOf(of),
    }),
  map: <Value>({
    key,
    value,
  }: {
    key: ColumnType<string>;
    value: ColumnType<Value>;
  }): ColumnType<Readonly<Record<string, Value>>> =>
    columnType<Readonly<Record<string, Value>>>({
      clickhouse: `Map(${key.clickhouse}, ${value.clickhouse})`,
      paramType: `Map(${key.paramType}, ${value.paramType})`,
      element: bindingOf(value),
    }),
  tuple: <const Items extends readonly ColumnType<unknown>[]>(...items: Items) =>
    columnType<{ readonly [K in keyof Items]: ValueOfType<Items[K]> }>({
      clickhouse: `Tuple(${items.map((each) => each.clickhouse).join(", ")})`,
      paramType: `Tuple(${items.map((each) => each.paramType).join(", ")})`,
    }),
  /** A SimpleAggregateFunction column holds a plain value, read and compared as `of`. */
  simpleAggregate: <Value>({ fn, of }: { fn: SimpleFunction; of: ColumnType<Value> }) => {
    if (!SIMPLE_FUNCTIONS.includes(fn))
      throw new QueryBuilderError({ kind: "unsupported-operand", column: fn });
    return columnType<Value>({
      ...bindingOf(of),
      clickhouse: `SimpleAggregateFunction(${fn}, ${of.clickhouse})`,
    });
  },
  /** An AggregateFunction column: a state no value compares with, read by `fn.<fn>Merge`. */
  aggregateFunction: <
    const Fn extends StateFunction,
    const Args extends readonly [ColumnType<unknown>, ...ColumnType<unknown>[]],
  >({
    fn,
    args,
  }: {
    fn: Fn;
    args: Args;
  }): ColumnType<AggregateState<Fn, StateResult<Fn, Args>>> => {
    if (!STATE_FUNCTIONS.includes(fn))
      throw new QueryBuilderError({ kind: "unsupported-operand", column: fn });
    const clickhouse = `AggregateFunction(${[fn, ...args.map((each) => each.clickhouse)].join(", ")})`;
    const result = COUNTED_RESULTS[fn] ?? bindingOf(args[0]);
    return columnType({ clickhouse, paramType: clickhouse, element: result });
  },
} as const;

type CompareOperator = "=" | "!=" | ">" | ">=" | "<" | "<=";
export type Direction = "ASC" | "DESC";

export type ColumnNode = {
  readonly kind: "column";
  /** The name the read refers to the table by: its own name, or an alias. */
  readonly table: string;
  /** The stored table the column belongs to; equal to `table` unless aliased. */
  readonly stored: string;
  readonly name: string;
};
export type ValueNode = {
  readonly kind: "value";
  readonly value: unknown;
  readonly binding: Binding;
};

export type ExpressionNode =
  | ColumnNode
  | ValueNode
  /** A finite number the grammar needs as a constant: a tuple index or a quantile level. */
  | { readonly kind: "literal"; readonly value: number }
  /** The two typeless constants a CAST gives a type to. */
  | { readonly kind: "constant"; readonly text: "NULL" | "[]" }
  /** `type` is checked against the type grammar before it is stored. */
  | { readonly kind: "cast"; readonly term: ExpressionNode; readonly type: string }
  | { readonly kind: "trim"; readonly term: ExpressionNode; readonly chars: ExpressionNode }
  /** Named by the render, in the order lambdas are written, so no caller text names it. */
  | { readonly kind: "lambdaParam" }
  | {
      readonly kind: "lambda";
      readonly params: readonly ExpressionNode[];
      readonly body: ExpressionNode;
    }
  | {
      readonly kind: "call";
      /** Set only by the `fn` catalogue, never from caller input. */
      readonly name: string;
      readonly parameters: readonly number[];
      readonly args: readonly ExpressionNode[];
    }
  | {
      readonly kind: "compare";
      readonly operator: CompareOperator;
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
    }
  | { readonly kind: "in"; readonly left: ExpressionNode; readonly set: ExpressionNode }
  | { readonly kind: "cte"; readonly name: string }
  | {
      readonly kind: "logic";
      readonly operator: "AND" | "OR";
      readonly terms: readonly ExpressionNode[];
    }
  | { readonly kind: "not"; readonly term: ExpressionNode }
  | { readonly kind: "isNull"; readonly term: ExpressionNode; readonly negated: boolean }
  | { readonly kind: "mapGet"; readonly map: ExpressionNode; readonly key: ExpressionNode }
  | { readonly kind: "fragment"; readonly id: ReviewedFragmentId; readonly table: string }
  | {
      readonly kind: "idBound";
      readonly keys: readonly { readonly column: ColumnNode; readonly value: ValueNode }[];
    }
  /** A one-value subquery the read builder rendered under the enclosing read's scope. */
  | { readonly kind: "scalar"; readonly render: (context: RenderContext) => string }
  | {
      readonly kind: "over";
      readonly call: ExpressionNode;
      readonly partitionBy: readonly ExpressionNode[];
      readonly orderBy: readonly { readonly node: ExpressionNode; readonly direction: Direction }[];
    };

/** A typed expression over the tables named in `Tables`; a column outside them does not compile. */
export type Expression<Value, Tables extends string = never> = {
  readonly [EXPRESSION]: true;
  readonly node: ExpressionNode;
  /** How a value compared with this expression binds; absent where no comparison applies. */
  readonly binding: Binding | undefined;
  readonly [valueBrand]?: Value;
  /** A getter type, so a value-only expression infers `never` tables, not `string`. */
  readonly [tablesBrand]?: () => Tables;
};

export type Condition<Tables extends string = never> = Expression<boolean, Tables>;

export type ValueOfExpression<E> = E extends Expression<infer Value, string> ? Value : never;
export type TablesOfExpression<E> = E extends Expression<unknown, infer Tables> ? Tables : never;

/** A declared column, as a table descriptor exposes it. */
export type ColumnRef<Table extends string, Name extends string, Value> = Expression<
  Value,
  Table
> & {
  readonly table: Table;
  readonly name: Name;
};

export const expression = <Value, Tables extends string = never>(
  node: ExpressionNode,
  binding?: Binding,
): Expression<Value, Tables> => ({ [EXPRESSION]: true, node, binding });

/** A column reference under a table name or alias, binding compared values as `binding` does. */
export function refOf<Table extends string, Name extends string, Value>({
  table,
  stored,
  name,
  binding,
}: {
  table: Table;
  stored: string;
  name: Name;
  binding: Binding | undefined;
}): ColumnRef<Table, Name, Value> {
  const node: ColumnNode = { kind: "column", table, stored, name };
  return { ...expression<Value, Table>(node, binding), table, name };
}

export function columnRef<Table extends string, Name extends string, Value>({
  table,
  name,
  type,
}: {
  table: Table;
  name: Name;
  type: ColumnType<Value>;
}): ColumnRef<Table, Name, Value> {
  return refOf({ table, stored: table, name, binding: bindingOf(type) });
}

export const isExpression = (value: unknown): value is Expression<unknown, string> =>
  typeof value === "object" && value !== null && EXPRESSION in value;

export const unsupported = (node: ExpressionNode) =>
  new QueryBuilderError({
    kind: "unsupported-operand",
    column: node.kind === "column" ? `${node.table}.${node.name}` : node.kind,
  });

/** An argument: an expression's node, or a caller value bound as `binding`. */
export function argumentNode({
  value,
  binding,
}: {
  value: unknown;
  binding: Binding | undefined;
}): ExpressionNode {
  if (isExpression(value)) return value.node;
  if (binding === undefined)
    throw new QueryBuilderError({ kind: "unsupported-operand", column: "value" });
  return { kind: "value", value, binding };
}

/** A caller value bound the way the expression it is compared with binds. */
function operandOf({ against, value }: { against: Expression<unknown, string>; value: unknown }) {
  if (isExpression(value)) return value.node;
  if (against.binding === undefined) throw unsupported(against.node);
  return { kind: "value", value, binding: against.binding } as const;
}

const compare =
  (operator: CompareOperator) =>
  (left: Expression<unknown, string>, right: unknown): Condition =>
    expression<boolean>({
      kind: "compare",
      operator,
      left: left.node,
      right: operandOf({ against: left, value: right }),
    });

type CteName<Ctes> = Extract<keyof Ctes, string>;

/** Names a common table expression of the read as the set an `oneOf` reads. */
export type CteSet<Ctes, Value> = {
  readonly cte: { [Name in CteName<Ctes>]: Ctes[Name] extends Value ? Name : never }[CteName<Ctes>];
};

/** A declared column holding string ids, Nullable included: a NULL id equals no bound one. */
type IdColumn<Tables extends string> = ColumnRef<Tables, string, string | null>;

/** One id, or a list read as `Key IN (…)`, as the raw marker's id parameter takes either. */
type Ids = string | readonly string[];

/** The operations a `where`, `prewhere`, `having`, selection or join condition is written with. */
export type ConditionOps<Tables extends string, Ctes> = {
  eq: <V, T extends Tables>(
    left: Expression<V, T>,
    right: NoInfer<V> | Expression<V, Tables>,
  ) => Condition;
  ne: <V, T extends Tables>(
    left: Expression<V, T>,
    right: NoInfer<V> | Expression<V, Tables>,
  ) => Condition;
  gt: <V, T extends Tables>(
    left: Expression<V, T>,
    right: NoInfer<V> | Expression<V, Tables>,
  ) => Condition;
  gte: <V, T extends Tables>(
    left: Expression<V, T>,
    right: NoInfer<V> | Expression<V, Tables>,
  ) => Condition;
  lt: <V, T extends Tables>(
    left: Expression<V, T>,
    right: NoInfer<V> | Expression<V, Tables>,
  ) => Condition;
  lte: <V, T extends Tables>(
    left: Expression<V, T>,
    right: NoInfer<V> | Expression<V, Tables>,
  ) => Condition;
  /** Membership in bound values or in a common table expression of the read. */
  oneOf: <V, T extends Tables>(
    left: Expression<V, T>,
    set: readonly NoInfer<V>[] | CteSet<Ctes, NoInfer<V>>,
  ) => Condition;
  /** `from` inclusive, `until` exclusive; either may be left open. */
  range: <V, T extends Tables>(
    left: Expression<V, T>,
    bounds: { from?: NoInfer<V>; until?: NoInfer<V> },
  ) => Condition;
  isNull: <T extends Tables>(term: Expression<unknown, T>) => Condition;
  isNotNull: <T extends Tables>(term: Expression<unknown, T>) => Condition;
  /** `Key = id`, or `Key IN (ids)`, with the `{{idBound}}` marker the client expands at send. */
  idBound: (column: IdColumn<Tables>, id: Ids) => Condition;
  /** The composite form: each key column equal to its id, one marker naming them all. */
  idBoundKeys: (...keys: readonly (readonly [IdColumn<Tables>, Ids])[]) => Condition;
  and: (...terms: Condition<Tables>[]) => Condition;
  or: (...terms: Condition<Tables>[]) => Condition;
  not: (term: Condition<Tables>) => Condition;
};

const logic =
  (operator: "AND" | "OR") =>
  (...terms: Condition<string>[]): Condition =>
    expression<boolean>({ kind: "logic", operator, terms: terms.map((term) => term.node) });

const MILLIS_OF: Readonly<Record<Conversion, string>> = {
  fromUnixTimestamp64Milli: "toUnixTimestamp64Milli",
};

/** Bound values compare in the parameter's own type; a DateTime64 compares as epoch millis. */
function oneOf(left: Expression<unknown, string>, set: unknown): Condition {
  if (!Array.isArray(set)) {
    const name = typeof set === "object" && set !== null && "cte" in set ? set.cte : undefined;
    if (typeof name !== "string") throw unsupported(left.node);
    return expression<boolean>({ kind: "in", left: left.node, set: { kind: "cte", name } });
  }
  if (left.binding === undefined) throw unsupported(left.node);
  const { conversion } = left.binding;
  const subject: ExpressionNode =
    conversion === undefined
      ? left.node
      : { kind: "call", name: MILLIS_OF[conversion], parameters: [], args: [left.node] };
  const binding = { paramType: `Array(${left.binding.paramType})` };
  const values: unknown[] = [...set];
  return expression<boolean>({
    kind: "in",
    left: subject,
    set: { kind: "value", value: values, binding },
  });
}

function range(
  left: Expression<unknown, string>,
  { from, until }: { from?: unknown; until?: unknown },
): Condition {
  const terms = [
    ...(from === undefined ? [] : [compare(">=")(left, from)]),
    ...(until === undefined ? [] : [compare("<")(left, until)]),
  ];
  return logic("AND")(...terms);
}

/** An id list must be strings and not empty: an empty one would look the index up for nothing. */
function idValueOf({ node, id }: { node: ExpressionNode; id: unknown }): ValueNode {
  if (typeof id === "string") return { kind: "value", value: id, binding: { paramType: "String" } };
  if (!Array.isArray(id) || !id.every((each) => typeof each === "string")) throw unsupported(node);
  if (id.length === 0) throw new QueryBuilderError({ kind: "empty-id-list" });
  return { kind: "value", value: [...id], binding: { paramType: "Array(String)" } };
}

function idBoundOf(keys: readonly (readonly [Expression<unknown, string>, unknown])[]): Condition {
  const pairs = keys.map(([key, id]) => {
    const { node } = key;
    if (node.kind !== "column") throw unsupported(node);
    return { column: node, value: idValueOf({ node, id }) };
  });
  const [first, ...rest] = pairs;
  if (first === undefined)
    throw new QueryBuilderError({ kind: "unsupported-operand", column: "idBound" });
  const other = rest.find((pair) => pair.column.table !== first.column.table);
  if (other !== undefined) throw unsupported(other.column);
  return expression<boolean>({ kind: "idBound", keys: pairs });
}

/** The operations typed for one read; its tables and CTE names exist at compile time only. */
export function conditionOpsFor<Tables extends string, Ctes>(): ConditionOps<Tables, Ctes> {
  return {
    eq: compare("="),
    ne: compare("!="),
    gt: compare(">"),
    gte: compare(">="),
    lt: compare("<"),
    lte: compare("<="),
    oneOf,
    range,
    isNull: (term) => expression<boolean>({ kind: "isNull", term: term.node, negated: false }),
    isNotNull: (term) => expression<boolean>({ kind: "isNull", term: term.node, negated: true }),
    idBound: (key, id) => idBoundOf([[key, id]]),
    idBoundKeys: (...keys) => idBoundOf(keys),
    and: logic("AND"),
    or: logic("OR"),
    not: (term) => expression<boolean>({ kind: "not", term: term.node }),
  };
}

/** Values bound by name with an explicit type, for a function argument or a tuple comparison. */
export const param = {
  string: (value: string) => valueExpression<string>({ value, paramType: "String" }),
  strings: (values: readonly string[]) =>
    valueExpression<readonly string[]>({ value: [...values], paramType: "Array(String)" }),
  uint16: (value: number) => valueExpression<number>({ value, paramType: "UInt16" }),
  uint32: (value: number) => valueExpression<number>({ value, paramType: "UInt32" }),
  uint64: (value: number) => valueExpression<number>({ value, paramType: "UInt64" }),
  int64: (value: number) => valueExpression<number>({ value, paramType: "Int64" }),
  float64: (value: number) => valueExpression<number>({ value, paramType: "Float64" }),
  int64s: (values: readonly number[]) =>
    valueExpression<readonly number[]>({ value: [...values], paramType: "Array(Int64)" }),
  date: (value: string) => valueExpression<string>({ value, paramType: "Date" }),
  /** Epoch milliseconds as a DateTime64, the way a DateTime64 column binds. */
  epochMs: (value: number) =>
    valueExpression<number>({ value, paramType: "Int64", conversion: "fromUnixTimestamp64Milli" }),
} as const;

function valueExpression<Value>({
  value,
  paramType,
  conversion,
}: {
  value: unknown;
  paramType: string;
  conversion?: Conversion;
}): Expression<Value> {
  const binding: Binding = conversion === undefined ? { paramType } : { paramType, conversion };
  return expression<Value>({ kind: "value", value, binding }, binding);
}

/** Text from the reviewed allow-list, readable only in a read over the table it names. */
export const sql = {
  /** `of` names the aliased descriptor the fragment reads, for a self-join; else the table. */
  fragment: <
    Id extends ReviewedFragmentId,
    Name extends string = (typeof REVIEWED_FRAGMENTS)[Id]["table"],
  >(
    id: Id,
    of?: { readonly $table: { readonly name: Name; readonly stored: string } },
  ) => {
    const { table } = REVIEWED_FRAGMENTS[id];
    if (of !== undefined && of.$table.stored !== table) {
      throw new QueryBuilderError({ kind: "foreign-column", table: of.$table.stored, column: id });
    }
    return expression<unknown, Name>({ kind: "fragment", id, table: of?.$table.name ?? table });
  },
} as const;

/** Where a statement's bound values collect; a node bound twice reuses its parameter. */
export type RenderContext = {
  readonly params: Record<string, unknown>;
  readonly slots: Map<ExpressionNode, string>;
  readonly counter: { next: number };
  /** Each lambda parameter's name, given when its lambda is written. */
  readonly lambdas: Map<ExpressionNode, string>;
  /** An id's parameter by its type and value, so every `{{idBound}}` marker names the same one. */
  readonly ids: Map<string, string>;
  /** The CTE names the text being rendered may read: earlier CTEs and the enclosing ones. */
  readonly ctes: { visible: ReadonlySet<string> };
};

export const renderContext = (): RenderContext => ({
  params: {},
  slots: new Map(),
  counter: { next: 0 },
  lambdas: new Map(),
  ids: new Map(),
  ctes: { visible: new Set() },
});

/** Binds a value node and returns its parameter name. */
export function paramNameOf({
  node,
  context,
}: {
  node: ValueNode;
  context: RenderContext;
}): string {
  let name = context.slots.get(node);
  if (name === undefined) {
    name = `v${context.counter.next}`;
    context.counter.next += 1;
    context.slots.set(node, name);
    context.params[name] = node.value;
  }
  return name;
}

/** Binds a value node under the next free name, or the name it already holds. */
export function slotOf({ node, context }: { node: ValueNode; context: RenderContext }) {
  const slot = `{${paramNameOf({ node, context })}:${node.binding.paramType}}`;
  return node.binding.conversion === undefined ? slot : `${node.binding.conversion}(${slot})`;
}

/** A fragment's declared columns, qualified outside its quoted strings when the read joins. */
function fragmentText({
  node,
  qualify,
}: {
  node: ExpressionNode & { kind: "fragment" };
  qualify: boolean;
}) {
  const fragment = REVIEWED_FRAGMENTS[node.id];
  if (!qualify) return fragment.sql;
  const names = new RegExp(`\\b(${fragment.columns.join("|")})\\b`, "g");
  return fragment.sql
    .split(/('(?:[^'\\]|\\.)*')/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(names, `${node.table}.$1`)))
    .join("");
}

export function renderExpression({
  node,
  context,
  qualify,
}: {
  node: ExpressionNode;
  context: RenderContext;
  qualify: boolean;
}): string {
  const render = (inner: ExpressionNode) => renderExpression({ node: inner, context, qualify });
  switch (node.kind) {
    case "column": {
      const name = node.name.includes(".") ? `\`${node.name}\`` : node.name;
      return qualify ? `${node.table}.${name}` : name;
    }
    case "value":
      return slotOf({ node, context });
    case "literal":
      return String(node.value);
    case "constant":
      return node.text;
    case "cast":
      return `CAST(${render(node.term)} AS ${node.type})`;
    case "trim":
      return `trim(BOTH ${render(node.chars)} FROM ${render(node.term)})`;
    case "lambdaParam": {
      const name = context.lambdas.get(node);
      if (name === undefined) throw unsupported(node);
      return name;
    }
    case "lambda":
      return lambdaText({ node, context, render });
    case "call": {
      const parameters = node.parameters.length > 0 ? `(${node.parameters.join(", ")})` : "";
      return `${node.name}${parameters}(${node.args.map(render).join(", ")})`;
    }
    case "compare":
      return `${render(node.left)} ${node.operator} ${render(node.right)}`;
    case "in":
      return inText({ node, context, render });
    case "cte":
      return node.name;
    case "logic":
      return node.terms.length === 0
        ? "1"
        : `(${node.terms.map(render).join(` ${node.operator} `)})`;
    case "not":
      return `NOT (${render(node.term)})`;
    case "isNull":
      return `${render(node.term)} IS ${node.negated ? "NOT NULL" : "NULL"}`;
    case "mapGet":
      return `${render(node.map)}[${render(node.key)}]`;
    case "fragment":
      return fragmentText({ node, qualify });
    case "idBound":
      return idBoundText({ node, context, render, qualify });
    case "scalar":
      return node.render(context);
    case "over":
      return overText({ node, render });
  }
}

/** `x IN (values)`, or `x IN cte`: a name no WITH in scope declares would read a stored table. */
function inText({
  node,
  context,
  render,
}: {
  node: ExpressionNode & { kind: "in" };
  context: RenderContext;
  render: (inner: ExpressionNode) => string;
}): string {
  if (node.set.kind !== "cte") return `${render(node.left)} IN (${render(node.set)})`;
  if (!context.ctes.visible.has(node.set.name))
    throw new QueryBuilderError({ kind: "unknown-cte", name: node.set.name });
  return `${render(node.left)} IN ${node.set.name}`;
}

/**
 * `(Key = {id} … {{idBound:<table>.<Keys>:<params>[:<alias>]}})`, `Key IN ({ids})` for a list, the
 * alias when qualified. Equal ids share one parameter: the client refuses markers naming two.
 */
function idBoundText({
  node,
  context,
  render,
  qualify,
}: {
  node: ExpressionNode & { kind: "idBound" };
  context: RenderContext;
  render: (inner: ExpressionNode) => string;
  qualify: boolean;
}): string {
  const names = node.keys.map(({ value }) => {
    const id = `${value.binding.paramType}:${JSON.stringify(value.value)}`;
    const name = context.ids.get(id) ?? paramNameOf({ node: value, context });
    context.ids.set(id, name);
    context.slots.set(value, name);
    return name;
  });
  const equalities = node.keys.map(({ column: key, value }) =>
    Array.isArray(value.value)
      ? `${render(key)} IN (${render(value)})`
      : `${render(key)} = ${render(value)}`,
  );
  const [first] = node.keys;
  const columns = node.keys.map(({ column: key }) => key.name).join(",");
  const alias = qualify ? `:${first?.column.table ?? ""}` : "";
  const marker = `{{idBound:${first?.column.stored ?? ""}.${columns}:${names.join(",")}${alias}}}`;
  return `(${equalities.join(" AND ")} ${marker})`;
}

/** `x0 -> body` or `(x0, x1) -> body`, each parameter named once, in writing order. */
function lambdaText({
  node,
  context,
  render,
}: {
  node: ExpressionNode & { kind: "lambda" };
  context: RenderContext;
  render: (inner: ExpressionNode) => string;
}): string {
  const names = node.params.map((param) => {
    const name = context.lambdas.get(param) ?? `__x${context.lambdas.size}`;
    context.lambdas.set(param, name);
    return name;
  });
  const head = names.length === 1 ? (names[0] ?? "") : `(${names.join(", ")})`;
  return `${head} -> ${render(node.body)}`;
}

/** `<call> OVER (PARTITION BY … ORDER BY …)`. */
function overText({
  node,
  render,
}: {
  node: ExpressionNode & { kind: "over" };
  render: (inner: ExpressionNode) => string;
}): string {
  const partition =
    node.partitionBy.length > 0 ? `PARTITION BY ${node.partitionBy.map(render).join(", ")}` : "";
  const orders = node.orderBy.map((each) => `${render(each.node)} ${each.direction}`);
  const order = orders.length > 0 ? `ORDER BY ${orders.join(", ")}` : "";
  return `${render(node.call)} OVER (${[partition, order].filter((part) => part !== "").join(" ")})`;
}

/** Every column an expression reads, for a join side's projection and the election's filters. */
export function columnsOf(node: ExpressionNode): { table: string; name: string }[] {
  switch (node.kind) {
    case "column":
      return [{ table: node.table, name: node.name }];
    case "value":
    case "literal":
    case "constant":
    case "cte":
    case "lambdaParam":
    // A scalar's own read checks its columns against its own tables.
    case "scalar":
      return [];
    case "cast":
      return columnsOf(node.term);
    case "trim":
      return [...columnsOf(node.term), ...columnsOf(node.chars)];
    case "lambda":
      return columnsOf(node.body);
    case "fragment":
      return REVIEWED_FRAGMENTS[node.id].columns.map((name) => ({ table: node.table, name }));
    case "call":
      return node.args.flatMap(columnsOf);
    case "compare":
      return [...columnsOf(node.left), ...columnsOf(node.right)];
    case "in":
      return [...columnsOf(node.left), ...columnsOf(node.set)];
    case "logic":
      return node.terms.flatMap(columnsOf);
    case "not":
    case "isNull":
      return columnsOf(node.term);
    case "mapGet":
      return [...columnsOf(node.map), ...columnsOf(node.key)];
    case "idBound":
      return node.keys.map(({ column: key }) => ({ table: key.table, name: key.name }));
    case "over":
      return [
        ...columnsOf(node.call),
        ...node.partitionBy.flatMap(columnsOf),
        ...node.orderBy.flatMap((each) => columnsOf(each.node)),
      ];
  }
}

/** Whether an expression holds an `{{idBound}}` marker anywhere. */
export function holdsIdBound(node: ExpressionNode): boolean {
  switch (node.kind) {
    case "idBound":
      return true;
    case "logic":
      return node.terms.some(holdsIdBound);
    case "not":
    case "isNull":
      return holdsIdBound(node.term);
    default:
      return false;
  }
}
