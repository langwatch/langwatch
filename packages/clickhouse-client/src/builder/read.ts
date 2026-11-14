/**
 * The typed read builder (ADR-202, "The typed builder"; Decided 7 and 9). A read starts from a
 * tenant scope, renders its predicate through the fence's own renderer and names the tenant
 * setting from the same tenants. It builds a statement; the client sends it.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { conditionsExpression, fenceExpression, PINNED_SETTINGS } from "../authorized-reads.ts";
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";
import { refuseOverBudget } from "../statementBudget.ts";
import { StatementScopeError } from "../statementScopeError.ts";
import {
  type Condition,
  type ConditionOps,
  columnsOf,
  conditionOpsFor,
  type Expression,
  type ExpressionNode,
  type RenderContext,
  renderContext,
  renderExpression,
  slotOf,
  type ValueOfExpression,
} from "./expression.ts";
import { QueryBuilderError } from "./query-builder-error.ts";
import type { AllTenantsScope, ReaderScope, TenantScope } from "./scope.ts";
import {
  type ClickHouseTable,
  type ClickHouseTableFacts,
  type ColumnsSpec,
  IDENTIFIER,
} from "./table.ts";

declare const rowBrand: unique symbol;

type Settings = typeof PINNED_SETTINGS;

export type ReaderReadStatement<Row = unknown> = {
  readonly identity: "reader";
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Settings & { readonly [TENANT_IDS_SETTING]: string };
  readonly tenantId: string;
  readonly tenantIds: readonly string[];
  readonly routeTenantId: string;
  /** A braided proof's expiry: the sender cuts the statement's time limit to it. */
  readonly expiresAt: number | undefined;
  readonly [rowBrand]?: Row;
};

export type SystemReadStatement<Row = unknown> = {
  readonly identity: "system";
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Settings;
  readonly reason: string;
  readonly [rowBrand]?: Row;
};

export type ClickHouseReadStatement<Row = unknown> =
  | ReaderReadStatement<Row>
  | SystemReadStatement<Row>;

type StatementOf<Scope extends TenantScope, Row> = Scope extends AllTenantsScope
  ? SystemReadStatement<Row>
  : ReaderReadStatement<Row>;

/** A statement for a path that sends on the reader identity only; refuses an all-tenants read. */
export function readerStatementOf<Row>({
  statement,
}: {
  statement: ClickHouseReadStatement<Row>;
}): ReaderReadStatement<Row> {
  if (statement.identity !== "reader")
    throw new QueryBuilderError({ kind: "all-tenants-on-reader" });
  return statement;
}

type HeldTrace = { kind: "traceId" | "sinceMs"; node: ExpressionNode & { kind: "value" } };
type Tenancy =
  | { kind: "unstated" }
  | { kind: "windows" }
  | { kind: "braided"; held: HeldTrace | undefined };
type Join = { kind: "INNER" | "LEFT"; table: ClickHouseTableFacts; on: ExpressionNode };
type Order = { target: ExpressionNode | string; direction: "ASC" | "DESC" };

type ReadState = {
  readonly scope: TenantScope;
  readonly table: ClickHouseTableFacts;
  readonly final: boolean;
  readonly joins: readonly Join[];
  readonly select: readonly (readonly [string, ExpressionNode])[];
  readonly where: readonly ExpressionNode[];
  readonly groupBy: readonly ExpressionNode[];
  readonly orderBy: readonly Order[];
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly tenancy: Tenancy;
  readonly latestVersion: boolean;
  readonly ctes: readonly { name: string; read: ReadState }[];
  readonly arms: readonly ReadState[];
};

type NoCtes = Record<never, never>;

/** The start of a read: the scope is required, the table comes next. */
export class ClickHouseReadStart<Scope extends TenantScope> {
  constructor(private readonly scope: Scope) {}

  from<Name extends string, Columns extends ColumnsSpec>(
    table: ClickHouseTable<Name, Columns>,
  ): ClickHouseRead<Scope, Name, NoCtes, NoCtes> {
    return new ClickHouseRead({
      scope: this.scope,
      table: table.$table,
      final: false,
      joins: [],
      select: [],
      where: [],
      groupBy: [],
      orderBy: [],
      limit: undefined,
      offset: undefined,
      tenancy: { kind: "unstated" },
      latestVersion: false,
      ctes: [],
      arms: [],
    });
  }
}

export function clickhouseRead<Scope extends TenantScope>({
  scope,
}: {
  scope: Scope;
}): ClickHouseReadStart<Scope> {
  if ((scope as TenantScope | undefined) === undefined)
    throw new QueryBuilderError({ kind: "missing-scope" });
  return new ClickHouseReadStart(scope);
}

const rowCount = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new QueryBuilderError({ kind: "bad-row-count", value });
  return value;
};

export class ClickHouseRead<
  Scope extends TenantScope,
  Tables extends string,
  Row extends Record<string, unknown>,
  Ctes extends Record<string, unknown>,
> {
  readonly #state: ReadState;

  constructor(state: ReadState) {
    this.#state = state;
  }

  #next<
    NextTables extends string = Tables,
    NextRow extends Record<string, unknown> = Row,
    NextCtes extends Record<string, unknown> = Ctes,
  >(patch: Partial<ReadState>): ClickHouseRead<Scope, NextTables, NextRow, NextCtes> {
    return new ClickHouseRead({ ...this.#state, ...patch });
  }

  select<Selection extends Record<string, Expression<unknown, Tables>>>(
    selection: Selection,
  ): ClickHouseRead<
    Scope,
    Tables,
    { [Key in keyof Selection]: ValueOfExpression<Selection[Key]> },
    Ctes
  > {
    return this.#next({
      select: Object.entries(selection).map(([key, value]) => [key, value.node] as const),
    });
  }

  where(
    build: (ops: ConditionOps<Tables, Ctes>) => Condition<Tables>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({
      where: [...this.#state.where, build(conditionOpsFor<Tables, Ctes>()).node],
    });
  }

  innerJoin<Name extends string, Columns extends ColumnsSpec>(
    table: ClickHouseTable<Name, Columns>,
    on: (ops: ConditionOps<Tables | Name, Ctes>) => Condition<Tables | Name>,
  ): ClickHouseRead<Scope, Tables | Name, Row, Ctes> {
    return this.#join({
      kind: "INNER",
      table: table.$table,
      on: on(conditionOpsFor<Tables | Name, Ctes>()).node,
    });
  }

  leftJoin<Name extends string, Columns extends ColumnsSpec>(
    table: ClickHouseTable<Name, Columns>,
    on: (ops: ConditionOps<Tables | Name, Ctes>) => Condition<Tables | Name>,
  ): ClickHouseRead<Scope, Tables | Name, Row, Ctes> {
    return this.#join({
      kind: "LEFT",
      table: table.$table,
      on: on(conditionOpsFor<Tables | Name, Ctes>()).node,
    });
  }

  #join<NextTables extends string>(join: Join): ClickHouseRead<Scope, NextTables, Row, Ctes> {
    const taken = [this.#state.table, ...this.#state.joins.map((each) => each.table)];
    if (taken.some((table) => table.name === join.table.name)) {
      throw new QueryBuilderError({ kind: "self-join", table: join.table.name });
    }
    if (this.#state.latestVersion) throw new QueryBuilderError({ kind: "latest-version-in-join" });
    return this.#next({ joins: [...this.#state.joins, join] });
  }

  groupBy(...expressions: Expression<unknown, Tables>[]): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({
      groupBy: [...this.#state.groupBy, ...expressions.map((each) => each.node)],
    });
  }

  orderBy(
    target: Expression<unknown, Tables> | (keyof Row & string),
    direction: "ASC" | "DESC" = "ASC",
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const order = { target: typeof target === "string" ? target : target.node, direction };
    return this.#next({ orderBy: [...this.#state.orderBy, order] });
  }

  limit(count: number): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({ limit: rowCount(count) });
  }

  offset(count: number): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({ offset: rowCount(count) });
  }

  /** `FINAL`, only where the sort key holds the tenant column, so versions never cross tenants. */
  final(): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const { table } = this.#state;
    if (!table.sortKey.includes(table.tenantColumn)) {
      throw new QueryBuilderError({ kind: "final-without-tenant-key", table: table.name });
    }
    return this.#next({ final: true });
  }

  /** The key-and-version election the latest-version marker renders, under the same scope. */
  latestVersion(): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const { table } = this.#state;
    if (table.versionColumn === undefined) {
      throw new QueryBuilderError({ kind: "no-version-column", table: table.name });
    }
    if (this.#state.joins.length > 0)
      throw new QueryBuilderError({ kind: "latest-version-in-join" });
    return this.#next({ latestVersion: true });
  }

  /** A proof's shared windows, as `{{tenantScope:<TimeColumn>}}` renders them. */
  withinWindows(): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const { scope } = this.#state;
    if (scope.kind !== "proof") throw new QueryBuilderError({ kind: "windows-need-a-proof" });
    if (scope.fence.braids !== undefined)
      throw new StatementScopeError({ kind: "plain-marker-under-braids" });
    return this.#next({ tenancy: { kind: "windows" } });
  }

  /** Windows and braid conditions under the held-trace semi-join, as the conditions marker. */
  braided({
    heldTrace,
  }: { heldTrace?: { traceId: string } | { sinceMs: number } } = {}): ClickHouseRead<
    Scope,
    Tables,
    Row,
    Ctes
  > {
    if (this.#state.scope.kind !== "proof")
      throw new QueryBuilderError({ kind: "windows-need-a-proof" });
    let held: HeldTrace | undefined;
    if (heldTrace !== undefined && "traceId" in heldTrace) {
      held = {
        kind: "traceId",
        node: { kind: "value", value: heldTrace.traceId, binding: { paramType: "String" } },
      };
    } else if (heldTrace !== undefined) {
      held = {
        kind: "sinceMs",
        node: { kind: "value", value: heldTrace.sinceMs, binding: { paramType: "Int64" } },
      };
    }
    return this.#next({ tenancy: { kind: "braided", held } });
  }

  /** A common table expression read under the same scope, named for `oneOf(column, { cte })`. */
  with<Name extends string, CteRow extends Record<string, unknown>, SubTables extends string>(
    name: Name,
    build: (sub: ClickHouseReadStart<Scope>) => ClickHouseRead<Scope, SubTables, CteRow, NoCtes>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes & Record<Name, CteRow[keyof CteRow]>> {
    const tables = [this.#state.table, ...this.#state.joins.map((join) => join.table)];
    const taken = new Set([
      ...tables.flatMap((table) => [table.name, ...table.columns]),
      ...this.#state.ctes.map((cte) => cte.name),
    ]);
    if (!IDENTIFIER.test(name) || taken.has(name)) {
      throw new QueryBuilderError({ kind: "bad-cte-name", name });
    }
    const read = build(new ClickHouseReadStart(this.#state.scope as Scope)).#state;
    return this.#next({ ctes: [...this.#state.ctes, { name, read }] });
  }

  /** A UNION ALL arm under the same scope, selecting the read's keys. */
  unionAll<ArmTables extends string>(
    build: (arm: ClickHouseReadStart<Scope>) => ClickHouseRead<Scope, ArmTables, Row, NoCtes>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const arm = build(new ClickHouseReadStart(this.#state.scope as Scope)).#state;
    return this.#next({ arms: [...this.#state.arms, arm] });
  }

  build(): StatementOf<Scope, Row> {
    const context = renderContext();
    const sql = renderStatement({ state: this.#state, context, nested: false });
    refuseOverBudget({ statement: sql, params: context.params });
    const { scope } = this.#state;
    const statement: ClickHouseReadStatement<Row> =
      scope.kind === "allTenants"
        ? {
            identity: "system",
            sql,
            params: context.params,
            settings: { ...PINNED_SETTINGS },
            reason: scope.reason,
          }
        : readerStatement({ scope, sql, params: context.params });
    // The scope's kind decided the identity above; the conditional type restates it.
    return statement as StatementOf<Scope, Row>;
  }
}

function readerStatement<Row>({
  scope,
  sql,
  params,
}: {
  scope: ReaderScope;
  sql: string;
  params: Record<string, unknown>;
}): ReaderReadStatement<Row> {
  return {
    identity: "reader",
    sql,
    params,
    settings: { ...PINNED_SETTINGS, [TENANT_IDS_SETTING]: scope.tenantIds.join(",") },
    tenantId: scope.tenantId,
    tenantIds: scope.tenantIds,
    routeTenantId: scope.routeTenantId,
    expiresAt: scope.kind === "proof" ? scope.expiresAt : undefined,
  };
}

function renderStatement({
  state,
  context,
  nested,
}: {
  state: ReadState;
  context: RenderContext;
  nested: boolean;
}): string {
  if (nested && (state.ctes.length > 0 || state.arms.length > 0)) {
    throw new QueryBuilderError({ kind: "nested-with" });
  }
  const parts: string[] = [];
  if (state.ctes.length > 0) {
    const ctes = state.ctes.map(
      (cte) => `${cte.name} AS (${renderStatement({ state: cte.read, context, nested: true })})`,
    );
    parts.push(`WITH ${ctes.join(", ")}`);
  }
  parts.push(renderSelect({ state, context, keys: undefined }));
  parts.push(...renderedArms({ state, context }));
  return parts.join(" ");
}

const isOrdered = (state: ReadState): boolean =>
  state.orderBy.length > 0 || state.limit !== undefined || state.offset !== undefined;

/** The UNION ALL arms, each in the read's key order; neither the read nor an arm is ordered. */
function renderedArms({ state, context }: { state: ReadState; context: RenderContext }): string[] {
  if (state.arms.length === 0) return [];
  if (isOrdered(state)) throw new QueryBuilderError({ kind: "ordered-union" });
  const keys = state.select.map(([key]) => key);
  return state.arms.map((arm) => {
    if (arm.ctes.length > 0 || arm.arms.length > 0) {
      throw new QueryBuilderError({ kind: "nested-with" });
    }
    if (isOrdered(arm)) throw new QueryBuilderError({ kind: "ordered-union" });
    return `UNION ALL ${renderSelect({ state: arm, context, keys })}`;
  });
}

/** One SELECT: its own scope predicate on every table it reads, then the caller's clauses. */
function renderSelect({
  state,
  context,
  keys,
}: {
  state: ReadState;
  context: RenderContext;
  keys: readonly string[] | undefined;
}): string {
  const tables = [state.table, ...state.joins.map((join) => join.table)];
  const qualify = state.joins.length > 0;
  const render = (node: ExpressionNode) => renderExpression({ node, context, qualify });
  refuseForeignColumns({ state, tables });
  const selection = selectionOf({ state, tables, keys });

  const list = selection.map(([key, node]) => {
    const rendered = render(node);
    const bare = node.kind === "column" && node.name === key && !qualify;
    return bare ? rendered : `${rendered} AS ${key}`;
  });
  const source = sourceOf({ state, context, render });
  const where = [
    ...(source.predicate === undefined ? [] : [source.predicate]),
    ...state.where.map(render),
    ...(state.latestVersion ? [electionOf({ state, context })] : []),
  ];
  const clauses = [
    `SELECT ${list.join(", ")}`,
    `FROM ${source.from}`,
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.map(render).join(", ")}` : "",
    orderClauseOf({ state, selection, render }),
    state.limit === undefined ? "" : `LIMIT ${state.limit}`,
    state.offset === undefined ? "" : `OFFSET ${state.offset}`,
  ];
  return clauses.filter((clause) => clause !== "").join(" ");
}

/** The FROM clause, and the scope's predicate on a one-table read; join sides carry their own. */
function sourceOf({
  state,
  context,
  render,
}: {
  state: ReadState;
  context: RenderContext;
  render: (node: ExpressionNode) => string;
}): { from: string; predicate: string | undefined } {
  if (state.joins.length === 0) {
    return {
      from: `${state.table.name}${state.final ? " FINAL" : ""}`,
      predicate: tenantPredicate({ state, table: state.table, context, election: false }),
    };
  }
  // The FROM side binds its parameters before the joined sides, in text order.
  const first = joinSide({ state, table: state.table, context });
  const joined = state.joins.map((join) => {
    const left = `${state.table.name}.${state.table.tenantColumn}`;
    const right = `${join.table.name}.${join.table.tenantColumn}`;
    const side = joinSide({ state, table: join.table, context });
    return `${join.kind} JOIN ${side} ON ${left} = ${right} AND ${render(join.on)}`;
  });
  return { from: [first, ...joined].join(" "), predicate: undefined };
}

function orderClauseOf({
  state,
  selection,
  render,
}: {
  state: ReadState;
  selection: readonly (readonly [string, ExpressionNode])[];
  render: (node: ExpressionNode) => string;
}): string {
  if (state.orderBy.length === 0) return "";
  const keys = new Set(selection.map(([key]) => key));
  const orders = state.orderBy.map(({ target, direction }) => {
    if (typeof target !== "string") return `${render(target)} ${direction}`;
    if (!keys.has(target)) throw new QueryBuilderError({ kind: "bad-alias", name: target });
    return `${target} ${direction}`;
  });
  return `ORDER BY ${orders.join(", ")}`;
}

function refuseForeignColumns({
  state,
  tables,
}: {
  state: ReadState;
  tables: readonly ClickHouseTableFacts[];
}) {
  const nodes = [
    ...state.select.map(([, node]) => node),
    ...state.where,
    ...state.groupBy,
    ...state.joins.map((join) => join.on),
    ...state.orderBy.flatMap(({ target }) => (typeof target === "string" ? [] : [target])),
  ];
  for (const { table, name } of nodes.flatMap(columnsOf)) {
    if (!tables.some((each) => each.name === table)) {
      throw new QueryBuilderError({ kind: "foreign-column", table, column: name });
    }
  }
}

/** The selection in the order asked for, refusing an alias that would shadow a declared column. */
function selectionOf({
  state,
  tables,
  keys,
}: {
  state: ReadState;
  tables: readonly ClickHouseTableFacts[];
  keys: readonly string[] | undefined;
}): (readonly [string, ExpressionNode])[] {
  if (state.select.length === 0) throw new QueryBuilderError({ kind: "empty-select" });
  const declared = new Set(tables.flatMap((table) => table.columns));
  for (const [key, node] of state.select) {
    if (!IDENTIFIER.test(key)) throw new QueryBuilderError({ kind: "bad-alias", name: key });
    const same = node.kind === "column" && node.name === key;
    if (declared.has(key) && !same)
      throw new StatementScopeError({ kind: "shadowing-alias", name: key });
  }
  if (keys === undefined) return [...state.select];
  const received = new Map(state.select);
  const ordered = keys.flatMap((key) => {
    const node = received.get(key);
    return node === undefined ? [] : [[key, node] as const];
  });
  if (ordered.length !== keys.length || received.size !== keys.length) {
    const expected = keys.join(", ");
    throw new QueryBuilderError({
      kind: "union-mismatch",
      expected,
      received: [...received.keys()].join(", "),
    });
  }
  return ordered;
}

/** A join side: a scoped subquery projecting its tenant column and every column read of it. */
function joinSide({
  state,
  table,
  context,
}: {
  state: ReadState;
  table: ClickHouseTableFacts;
  context: RenderContext;
}): string {
  const nodes = [
    ...state.select.map(([, node]) => node),
    ...state.where,
    ...state.groupBy,
    ...state.joins.map((join) => join.on),
    ...state.orderBy.flatMap(({ target }) => (typeof target === "string" ? [] : [target])),
  ];
  const read = new Set(
    nodes
      .flatMap(columnsOf)
      .filter((each) => each.table === table.name)
      .map((each) => each.name),
  );
  const projected = table.columns.filter(
    (name) => name === table.tenantColumn || read.has(name) || read.has("*"),
  );
  const isFrom = table.name === state.table.name;
  const predicate = tenantPredicate({ state, table, context, election: false });
  const where = predicate === undefined ? "" : ` WHERE ${predicate}`;
  const final = isFrom && state.final ? " FINAL" : "";
  return `(SELECT ${projected.join(", ")} FROM ${table.name}${final}${where}) AS ${table.name}`;
}

/**
 * The scope's predicate for one table. A proof renders through the fence's own renderer, the
 * same functions its markers expand by; a single or set scope binds its tenants as parameters.
 */
function tenantPredicate({
  state,
  table,
  context,
  election,
}: {
  state: ReadState;
  table: ClickHouseTableFacts;
  context: RenderContext;
  election: boolean;
}): string | undefined {
  const { scope, tenancy } = state;
  switch (scope.kind) {
    case "allTenants":
      return undefined;
    case "single":
      context.params.tenantId = scope.tenantId;
      return `${table.tenantColumn} = {tenantId:String}`;
    case "set":
      context.params.tenantIds = [...scope.tenantIds];
      return `${table.tenantColumn} IN ({tenantIds:Array(String)})`;
    case "proof":
      break;
  }
  if (table.tenantColumn !== "TenantId") {
    throw new QueryBuilderError({
      kind: "proof-needs-tenant-id-column",
      table: table.name,
      tenantColumn: table.tenantColumn,
    });
  }
  if (tenancy.kind === "unstated") throw new StatementScopeError({ kind: "missing-marker" });
  const column = table.timeColumn;
  if (column === undefined)
    throw new QueryBuilderError({ kind: "no-time-column", table: table.name });
  const { fence } = scope;
  let expression: { sql: string; params: Record<string, unknown> };
  if (election || tenancy.kind === "windows") {
    expression = fenceExpression({ fence, column });
  } else {
    const held =
      tenancy.held === undefined
        ? undefined
        : { kind: tenancy.held.kind, param: paramOf({ node: tenancy.held.node, context }) };
    expression = conditionsExpression({ fence, column, held });
  }
  Object.assign(context.params, expression.params);
  return expression.sql;
}

/** Binds a value node and returns its parameter name, for a renderer that writes its own slot. */
function paramOf({
  node,
  context,
}: {
  node: ExpressionNode & { kind: "value" };
  context: RenderContext;
}): string {
  slotOf({ node, context });
  const name = context.slots.get(node);
  if (name === undefined) throw new Error("a bound value holds a parameter name");
  return name;
}

/**
 * The latest-version election: keys and version from the descriptor, under the fence's
 * latest-version form, repeating the read's conjuncts that filter on key columns alone.
 */
function electionOf({ state, context }: { state: ReadState; context: RenderContext }): string {
  const { table } = state;
  const version = table.versionColumn ?? "";
  const keys = table.sortKey;
  const filtersKeys = (node: ExpressionNode) => {
    const read = columnsOf(node);
    return (
      read.length > 0 &&
      read.every(
        (each) =>
          each.table === table.name && each.name !== table.tenantColumn && keys.includes(each.name),
      )
    );
  };
  const where: string[] = [];
  const predicate = tenantPredicate({ state, table, context, election: true });
  if (predicate !== undefined) where.push(predicate);
  for (const node of state.where.filter(filtersKeys)) {
    where.push(renderExpression({ node, context, qualify: false }));
  }
  const filter = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  return (
    `(${[...keys, version].join(", ")}) IN (SELECT ${keys.join(", ")}, max(${version}) FROM ${table.name}` +
    `${filter} GROUP BY ${keys.join(", ")})`
  );
}
