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

/** How a value compared with an expression is bound: its parameter type and any conversion. */
type Binding = { readonly paramType: string; readonly conversion?: Conversion };

/** A column's declared ClickHouse type, carrying the TypeScript value a bound value of it takes. */
export type ColumnType<Value> = Binding & {
  readonly clickhouse: string;
  readonly [valueBrand]?: Value;
};

const columnType = <Value>(spec: Binding & { clickhouse: string }): ColumnType<Value> => spec;
const plain = <Value>(clickhouse: string) =>
  columnType<Value>({ clickhouse, paramType: clickhouse });

/** The column types a table descriptor declares. A DateTime64 binds epoch milliseconds. */
export const column = {
  string: () => plain<string>("String"),
  lowCardinalityString: () =>
    columnType<string>({ clickhouse: "LowCardinality(String)", paramType: "String" }),
  uint8: () => plain<number>("UInt8"),
  uint32: () => plain<number>("UInt32"),
  uint64: () => plain<number>("UInt64"),
  int64: () => plain<number>("Int64"),
  float64: () => plain<number>("Float64"),
  dateTime64: ({ precision }: { precision: 3 | 6 | 9 }) =>
    columnType<number>({
      clickhouse: `DateTime64(${precision})`,
      paramType: "Int64",
      conversion: "fromUnixTimestamp64Milli",
    }),
  stringMap: () => plain<Readonly<Record<string, string>>>("Map(String, String)"),
  stringArray: () => plain<readonly string[]>("Array(String)"),
} as const;

type CallName = "count" | "max" | "min" | "any" | "sum" | "argMax" | "toUnixTimestamp64Milli";
type CompareOperator = "=" | "!=" | ">" | ">=" | "<" | "<=";

export type ExpressionNode =
  | { readonly kind: "column"; readonly table: string; readonly name: string }
  | { readonly kind: "value"; readonly value: unknown; readonly binding: Binding }
  | { readonly kind: "call"; readonly name: CallName; readonly args: readonly ExpressionNode[] }
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
  | { readonly kind: "mapGet"; readonly map: ExpressionNode; readonly key: ExpressionNode }
  | { readonly kind: "fragment"; readonly id: ReviewedFragmentId };

/** A typed expression over the tables named in `Tables`; a column outside them does not compile. */
export type Expression<Value, Tables extends string = never> = {
  readonly [EXPRESSION]: true;
  readonly node: ExpressionNode;
  /** How a value compared with this expression binds; absent where no comparison applies. */
  readonly binding: Binding | undefined;
  readonly [valueBrand]?: Value;
  readonly [tablesBrand]?: Tables;
};

export type Condition<Tables extends string = never> = Expression<boolean, Tables>;

export type ValueOfExpression<E> = E extends Expression<infer Value, string> ? Value : never;

/** A declared column, as a table descriptor exposes it. */
export type ColumnRef<Table extends string, Name extends string, Value> = Expression<
  Value,
  Table
> & {
  readonly table: Table;
  readonly name: Name;
};

const expression = <Value, Tables extends string = never>(
  node: ExpressionNode,
  binding?: Binding,
): Expression<Value, Tables> => ({ [EXPRESSION]: true, node, binding });

export function columnRef<Table extends string, Name extends string, Value>({
  table,
  name,
  type,
}: {
  table: Table;
  name: Name;
  type: ColumnType<Value>;
}): ColumnRef<Table, Name, Value> {
  const binding: Binding =
    type.conversion === undefined
      ? { paramType: type.paramType }
      : { paramType: type.paramType, conversion: type.conversion };
  return { ...expression<Value, Table>({ kind: "column", table, name }, binding), table, name };
}

const isExpression = (value: unknown): value is Expression<unknown, string> =>
  typeof value === "object" && value !== null && EXPRESSION in value;

/** A caller value bound the way the expression it is compared with binds. */
function operandOf({ against, value }: { against: Expression<unknown, string>; value: unknown }) {
  if (isExpression(value)) return value.node;
  if (against.binding === undefined) throw unsupported(against.node);
  return { kind: "value", value, binding: against.binding } as const;
}

const unsupported = (node: ExpressionNode) =>
  new QueryBuilderError({
    kind: "unsupported-operand",
    column: node.kind === "column" ? `${node.table}.${node.name}` : node.kind,
  });

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

/** The operations a `where` or join condition is written with. */
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
  and: (...terms: Condition<Tables>[]) => Condition;
  or: (...terms: Condition<Tables>[]) => Condition;
  not: (term: Condition<Tables>) => Condition;
};

const logic =
  (operator: "AND" | "OR") =>
  (...terms: Condition<string>[]): Condition =>
    expression<boolean>({ kind: "logic", operator, terms: terms.map((term) => term.node) });

function oneOf(left: Expression<unknown, string>, set: unknown): Condition {
  if (!Array.isArray(set)) {
    const name = typeof set === "object" && set !== null && "cte" in set ? set.cte : undefined;
    if (typeof name !== "string") throw unsupported(left.node);
    return expression<boolean>({ kind: "in", left: left.node, set: { kind: "cte", name } });
  }
  if (left.binding === undefined || left.binding.conversion !== undefined) {
    throw unsupported(left.node);
  }
  const binding = { paramType: `Array(${left.binding.paramType})` };
  const values: unknown[] = [...set];
  return expression<boolean>({
    kind: "in",
    left: left.node,
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
    and: logic("AND"),
    or: logic("OR"),
    not: (term) => expression<boolean>({ kind: "not", term: term.node }),
  };
}

const call = <Value, Tables extends string>(
  name: CallName,
  args: readonly Expression<unknown, string>[],
  binding?: Binding,
) => expression<Value, Tables>({ kind: "call", name, args: args.map((arg) => arg.node) }, binding);

/** The functions a selection, a grouping or an order may call; the set grows by review. */
export const fn = {
  count: () => call<number, never>("count", [], { paramType: "UInt64" }),
  max: <V, T extends string>(of: Expression<V, T>) => call<V, T>("max", [of], of.binding),
  min: <V, T extends string>(of: Expression<V, T>) => call<V, T>("min", [of], of.binding),
  any: <V, T extends string>(of: Expression<V, T>) => call<V, T>("any", [of], of.binding),
  sum: <T extends string>(of: Expression<number, T>) =>
    call<number, T>("sum", [of], { paramType: "Float64" }),
  argMax: <V, T extends string, U extends string>(
    value: Expression<V, T>,
    by: Expression<unknown, U>,
  ) => call<V, T | U>("argMax", [value, by], value.binding),
  toUnixTimestamp64Milli: <T extends string>(of: Expression<number, T>) =>
    call<number, T>("toUnixTimestamp64Milli", [of], { paramType: "Int64" }),
  mapGet: <T extends string>(map: Expression<Readonly<Record<string, string>>, T>, key: string) =>
    expression<string, T>(
      {
        kind: "mapGet",
        map: map.node,
        key: { kind: "value", value: key, binding: { paramType: "String" } },
      },
      { paramType: "String" },
    ),
} as const;

/** Text from the reviewed allow-list, readable only in a read over the table it names. */
export const sql = {
  fragment: <Id extends ReviewedFragmentId>(id: Id) =>
    expression<unknown, (typeof REVIEWED_FRAGMENTS)[Id]["table"]>({ kind: "fragment", id }),
} as const;

/** Where a statement's bound values collect; a node bound twice reuses its parameter. */
export type RenderContext = {
  readonly params: Record<string, unknown>;
  readonly slots: Map<ExpressionNode, string>;
  readonly counter: { next: number };
};

export const renderContext = (): RenderContext => ({
  params: {},
  slots: new Map(),
  counter: { next: 0 },
});

/** Binds a value node under the next free name, or the name it already holds. */
export function slotOf({
  node,
  context,
}: {
  node: ExpressionNode & { kind: "value" };
  context: RenderContext;
}) {
  let name = context.slots.get(node);
  if (name === undefined) {
    name = `v${context.counter.next}`;
    context.counter.next += 1;
    context.slots.set(node, name);
    context.params[name] = node.value;
  }
  const slot = `{${name}:${node.binding.paramType}}`;
  return node.binding.conversion === undefined ? slot : `${node.binding.conversion}(${slot})`;
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
    case "column":
      return qualify ? `${node.table}.${node.name}` : node.name;
    case "value":
      return slotOf({ node, context });
    case "call":
      return `${node.name}(${node.args.map(render).join(", ")})`;
    case "compare":
      return `${render(node.left)} ${node.operator} ${render(node.right)}`;
    case "in":
      return node.set.kind === "cte"
        ? `${render(node.left)} IN ${node.set.name}`
        : `${render(node.left)} IN (${render(node.set)})`;
    case "cte":
      return node.name;
    case "logic":
      return node.terms.length === 0
        ? "1"
        : `(${node.terms.map(render).join(` ${node.operator} `)})`;
    case "not":
      return `NOT (${render(node.term)})`;
    case "mapGet":
      return `${render(node.map)}[${render(node.key)}]`;
    case "fragment":
      return REVIEWED_FRAGMENTS[node.id].sql;
  }
}

/** Every column an expression reads, for a join side's projection and the election's filters. */
export function columnsOf(node: ExpressionNode): { table: string; name: string }[] {
  switch (node.kind) {
    case "column":
      return [{ table: node.table, name: node.name }];
    case "value":
    case "cte":
      return [];
    case "fragment":
      return [{ table: REVIEWED_FRAGMENTS[node.id].table, name: "*" }];
    case "call":
      return node.args.flatMap(columnsOf);
    case "compare":
      return [...columnsOf(node.left), ...columnsOf(node.right)];
    case "in":
      return [...columnsOf(node.left), ...columnsOf(node.set)];
    case "logic":
      return node.terms.flatMap(columnsOf);
    case "not":
      return columnsOf(node.term);
    case "mapGet":
      return [...columnsOf(node.map), ...columnsOf(node.key)];
  }
}
