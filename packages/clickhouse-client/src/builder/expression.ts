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
export type Binding = { readonly paramType: string; readonly conversion?: Conversion };

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
  bool: () => plain<boolean>("Bool"),
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
  stringMap: () => plain<Readonly<Record<string, string>>>("Map(String, String)"),
  stringArray: () => plain<readonly string[]>("Array(String)"),
  int64Array: () => plain<readonly number[]>("Array(Int64)"),
  /** A Nullable column binds a compared value as its inner type does. */
  nullable: <Value>(inner: ColumnType<Value>): ColumnType<Value | null> =>
    columnType<Value | null>({
      clickhouse: `Nullable(${inner.clickhouse})`,
      paramType: inner.paramType,
      ...(inner.conversion === undefined ? {} : { conversion: inner.conversion }),
    }),
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
  readonly [tablesBrand]?: Tables;
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
  const binding: Binding =
    type.conversion === undefined
      ? { paramType: type.paramType }
      : { paramType: type.paramType, conversion: type.conversion };
  return refOf({ table, stored: table, name, binding });
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

/** A declared column holding string ids, as an `{{idBound}}` marker names its key. */
type IdColumn<Tables extends string> = ColumnRef<Tables, string, string>;

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
  /** `Key = id` with the id index's `{{idBound}}` marker, which the client expands at send. */
  idBound: (column: IdColumn<Tables>, id: string) => Condition;
  /** The composite form: each key column equal to its id, one marker naming them all. */
  idBoundKeys: (...keys: readonly (readonly [IdColumn<Tables>, string])[]) => Condition;
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

function idBoundOf(keys: readonly (readonly [Expression<unknown, string>, unknown])[]): Condition {
  const pairs = keys.map(([key, id]) => {
    const { node } = key;
    if (node.kind !== "column" || typeof id !== "string") throw unsupported(node);
    const value: ValueNode = { kind: "value", value: id, binding: { paramType: "String" } };
    return { column: node, value };
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
  uint32: (value: number) => valueExpression<number>({ value, paramType: "UInt32" }),
  uint64: (value: number) => valueExpression<number>({ value, paramType: "UInt64" }),
  int64: (value: number) => valueExpression<number>({ value, paramType: "Int64" }),
  float64: (value: number) => valueExpression<number>({ value, paramType: "Float64" }),
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
};

export const renderContext = (): RenderContext => ({
  params: {},
  slots: new Map(),
  counter: { next: 0 },
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
    case "column":
      return qualify ? `${node.table}.${node.name}` : node.name;
    case "value":
      return slotOf({ node, context });
    case "literal":
      return String(node.value);
    case "call": {
      const parameters = node.parameters.length > 0 ? `(${node.parameters.join(", ")})` : "";
      return `${node.name}${parameters}(${node.args.map(render).join(", ")})`;
    }
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
    case "isNull":
      return `${render(node.term)} IS ${node.negated ? "NOT NULL" : "NULL"}`;
    case "mapGet":
      return `${render(node.map)}[${render(node.key)}]`;
    case "fragment":
      return fragmentText({ node, qualify });
    case "idBound":
      return idBoundText({ node, context, render, qualify });
    case "over":
      return overText({ node, render });
  }
}

/** `(Key = {id} … {{idBound:<table>.<Keys>:<params>[:<alias>]}})`, the alias when qualified. */
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
  const equalities = node.keys.map(({ column: key, value }) => `${render(key)} = ${render(value)}`);
  const [first] = node.keys;
  const columns = node.keys.map(({ column: key }) => key.name).join(",");
  const names = node.keys.map(({ value }) => paramNameOf({ node: value, context })).join(",");
  const alias = qualify ? `:${first?.column.table ?? ""}` : "";
  const marker = `{{idBound:${first?.column.stored ?? ""}.${columns}:${names}${alias}}}`;
  return `(${equalities.join(" AND ")} ${marker})`;
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
    case "cte":
      return [];
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
