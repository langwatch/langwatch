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
import { boundRowsSource, isBoundRows } from "./bound-rows.ts";
import {
  type Binding,
  type ColumnRef,
  type ColumnType,
  type Condition,
  type ConditionOps,
  columnsOf,
  conditionOpsFor,
  type Direction,
  type Expression,
  type ExpressionNode,
  holdsIdBound,
  paramNameOf,
  refOf,
  type RenderContext,
  renderContext,
  renderExpression,
  type ValueNode,
  type ValueOfExpression,
  expression,
} from "./expression.ts";
import { QueryBuilderError } from "./query-builder-error.ts";
import type { AllTenantsScope, ReaderScope, ServerMetadataScope, TenantScope } from "./scope.ts";
import {
  type ClickHouseTable,
  type ClickHouseTableFacts,
  type ColumnsSpec,
  IDENTIFIER,
  SERVER_METADATA_TABLES,
} from "./table.ts";

declare const rowBrand: unique symbol;

type Settings = typeof PINNED_SETTINGS;

export type ReaderReadStatement<Row = unknown> = {
  readonly identity: "reader";
  readonly kind: "tenant";
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Settings & { readonly [TENANT_IDS_SETTING]: string };
  readonly tenantId: string;
  /** Set for set and proof scopes; a single scope is checked by its `TenantId = {tenantId}`. */
  readonly tenantIds: readonly string[] | undefined;
  readonly routeTenantId: string;
  /** Each tenant column its predicates bind (a descriptor's own, e.g. `project_id`). */
  readonly tenantColumns: readonly string[];
  /** A braided proof's expiry: the sender cuts the statement's time limit to it. */
  readonly expiresAt: number | undefined;
  readonly [rowBrand]?: Row;
};

export type SystemReadStatement<Row = unknown> = {
  readonly identity: "system";
  readonly kind: "allTenants";
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Settings;
  readonly reason: string;
  readonly [rowBrand]?: Row;
};

/** Server metadata on the reader identity, no tenant setting (`tenantScope.serverMetadata`). */
export type MetadataReadStatement<Row = unknown> = {
  readonly identity: "reader";
  readonly kind: "metadata";
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Settings;
  readonly reason: string;
  readonly [rowBrand]?: Row;
};

/** What the client's built path sends today; a metadata statement joins when it is wired. */
export type ClickHouseReadStatement<Row = unknown> =
  | ReaderReadStatement<Row>
  | SystemReadStatement<Row>;

type StatementOf<Scope extends TenantScope, Row> = Scope extends AllTenantsScope
  ? SystemReadStatement<Row>
  : Scope extends ServerMetadataScope
    ? MetadataReadStatement<Row>
    : ReaderReadStatement<Row>;

/** A statement for a path that sends tenant reads only; refuses every other kind. */
export function readerStatementOf<Row>({
  statement,
}: {
  statement: ClickHouseReadStatement<Row>;
}): ReaderReadStatement<Row> {
  if (statement.identity !== "reader")
    throw new QueryBuilderError({ kind: "all-tenants-on-reader" });
  return statement;
}

type HeldTrace = { kind: "traceId" | "sinceMs"; node: ValueNode };
type Tenancy =
  | { kind: "unstated" }
  | { kind: "windows" }
  | { kind: "braided"; held: HeldTrace | undefined };
type Join = {
  kind: "INNER" | "LEFT";
  table: ClickHouseTableFacts;
  on: ExpressionNode;
  latestVersion: boolean;
};
type Order = { target: ExpressionNode | string; direction: Direction };
type Selected = { key: string; node: ExpressionNode; binding: Binding | undefined };

type ReadState = {
  readonly scope: TenantScope;
  readonly table: ClickHouseTableFacts;
  readonly final: boolean;
  readonly joins: readonly Join[];
  readonly select: readonly Selected[];
  readonly distinct: boolean;
  readonly prewhere: readonly ExpressionNode[];
  readonly where: readonly ExpressionNode[];
  readonly groupBy: readonly ExpressionNode[];
  readonly having: readonly ExpressionNode[];
  readonly orderBy: readonly Order[];
  readonly limitBy: { readonly count: number; readonly by: readonly ExpressionNode[] } | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly tenancy: Tenancy;
  /** Where the latest-version election renders: WHERE or PREWHERE. */
  readonly latestVersion: "where" | "prewhere" | undefined;
  /** The elected table's columns the caller declared stable per key; the election repeats them. */
  readonly repeats: readonly string[];
  /** The column the FROM side's election takes the max of, when not the descriptor's version. */
  readonly version: string | undefined;
  /** The indices of `where` conditions that filter the elected rows only, never the election. */
  readonly outerOnly: readonly number[];
  readonly ctes: readonly { name: string; read: ReadState }[];
  readonly arms: readonly ReadState[];
  /** The read's own `SETTINGS` clause: never a `SQL_` key, never a pinned setting. */
  readonly settings: Readonly<Record<string, number | string>>;
};

type NoCtes = Record<never, never>;

/** The table kinds a scope reads: server metadata reads system tables, others tenants' and rows. */
type KindFor<Scope extends TenantScope> = Scope extends ServerMetadataScope
  ? "system"
  : "tenant" | "rows";

/** A read used as a table: its selected keys, typed by the values they hold. */
export type DerivedColumns<Row> = { readonly [Key in keyof Row & string]: ColumnType<Row[Key]> };

/** The read each derived table was built from, so `from` renders it and checks its scope. */
const DERIVED = new WeakMap<ClickHouseTableFacts, ReadState>();

/** The source of a read with no table: `SELECT <constants>`, server metadata only. */
const NO_TABLE: ClickHouseTableFacts = {
  kind: "system",
  name: "",
  stored: "",
  tenantColumn: "",
  timeColumn: undefined,
  versionColumn: undefined,
  sortKey: [],
  columns: [],
};

const initialState = ({
  scope,
  table,
}: {
  scope: TenantScope;
  table: ClickHouseTableFacts;
}): ReadState => ({
  scope,
  table,
  final: false,
  joins: [],
  select: [],
  distinct: false,
  prewhere: [],
  where: [],
  groupBy: [],
  having: [],
  orderBy: [],
  limitBy: undefined,
  limit: undefined,
  offset: undefined,
  tenancy: { kind: "unstated" },
  latestVersion: undefined,
  repeats: [],
  version: undefined,
  outerOnly: [],
  ctes: [],
  arms: [],
  settings: {},
});

/** Refuses a table the scope may not read: tenants read tenant tables, metadata the allow-list. */
function checkSource({ scope, table }: { scope: TenantScope; table: ClickHouseTableFacts }) {
  if (table.kind === "derived") {
    if (DERIVED.get(table)?.scope !== scope) throw new QueryBuilderError({ kind: "foreign-scope" });
    return;
  }
  // Bound rows hold no tenant rows; `no-tenant-table` at build keeps them from standing in for one.
  if (table.kind === "rows" && scope.kind !== "serverMetadata" && isBoundRows(table)) return;
  const allowed =
    scope.kind === "serverMetadata"
      ? table.kind === "system" &&
        (SERVER_METADATA_TABLES as readonly string[]).includes(table.stored)
      : table.kind === "tenant" && IDENTIFIER.test(table.stored);
  if (!allowed) {
    throw new QueryBuilderError({
      kind: "table-outside-scope",
      table: table.stored,
      scope: scope.kind,
    });
  }
}

/** The column an election takes the max of: the elected table's own, never its tenant column. */
function electedVersionOf({
  table,
  version,
}: {
  table: ClickHouseTableFacts;
  version: ColumnRef<string, string, unknown>;
}): string {
  const { node } = version;
  if (node.kind === "column" && node.table === table.name && node.name !== table.tenantColumn) {
    return node.name;
  }
  const column = node.kind === "column" ? `${node.table}.${node.name}` : node.kind;
  throw new QueryBuilderError({ kind: "version-outside-election", table: table.name, column });
}

/** Whether a read selects its FROM side's tenant column as itself, under that column's name. */
function selectsOwnTenant({ table, select }: ReadState): boolean {
  return select.some(
    ({ key, node }) =>
      table.tenantColumn !== "" &&
      key === table.tenantColumn &&
      node.kind === "column" &&
      node.table === table.name &&
      node.name === table.tenantColumn,
  );
}

/** The start of a read: the scope is required, the table comes next; a CTE body sees `Ctes`. */
export class ClickHouseReadStart<
  Scope extends TenantScope,
  Ctes extends Record<string, unknown> = NoCtes,
> {
  constructor(private readonly scope: Scope) {}

  from<Name extends string, Columns extends ColumnsSpec>(
    table: ClickHouseTable<Name, Columns, KindFor<Scope> | "derived">,
  ): ClickHouseRead<Scope, Name, NoCtes, Ctes> {
    checkSource({ scope: this.scope, table: table.$table });
    return new ClickHouseRead(initialState({ scope: this.scope, table: table.$table }));
  }

  /** `SELECT <constants>` with no table, such as a server-metadata `SELECT 1`. */
  withoutTable(
    this: ClickHouseReadStart<ServerMetadataScope>,
  ): ClickHouseRead<ServerMetadataScope, never, NoCtes, NoCtes> {
    const scope = this.scope as TenantScope;
    if (scope.kind !== "serverMetadata") {
      throw new QueryBuilderError({ kind: "table-outside-scope", table: "", scope: scope.kind });
    }
    return new ClickHouseRead(initialState({ scope, table: NO_TABLE }));
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

const PINNED_KEYS = new Set(Object.keys(PINNED_SETTINGS).map((key) => key.toLowerCase()));
const SETTING_WORD = /^[A-Za-z0-9_]+$/;

/** A setting a read may name: a plain key outside `SQL_*` and the pinned set, a plain value. */
function checkedSetting({ key, value }: { key: string; value: number | string }): void {
  const refused =
    !IDENTIFIER.test(key) ||
    /^sql_/i.test(key) ||
    PINNED_KEYS.has(key.toLowerCase()) ||
    (typeof value === "number" ? !Number.isFinite(value) : !SETTING_WORD.test(value));
  if (refused) throw new QueryBuilderError({ kind: "refused-setting", setting: key });
}

function settingsClauseOf(state: ReadState): string {
  const entries = Object.entries(state.settings);
  if (entries.length === 0) return "";
  const rendered = entries.map(([key, value]) =>
    typeof value === "number" ? `${key} = ${value}` : `${key} = '${value}'`,
  );
  return `SETTINGS ${rendered.join(", ")}`;
}

/** A SETTINGS clause binds one SELECT, so neither a union nor its arms may carry one. */
function refuseSettingsInUnion(state: ReadState): void {
  if ([state, ...state.arms].some((each) => Object.keys(each.settings).length > 0)) {
    throw new QueryBuilderError({ kind: "settings-in-union" });
  }
}

type JoinOptions = { latestVersion?: boolean };
/** `inElection: false`: the condition filters the elected rows only, as main's page cursors do. */
type WhereOptions = { inElection?: boolean };

/** A read's own clause operations: the condition operations and a scalar subquery. */
export type ReadOps<
  Scope extends TenantScope,
  Tables extends string,
  Ctes extends Record<string, unknown>,
> = ConditionOps<Tables, Ctes> & {
  /** `(SELECT <one value> …)` under this read's scope: its tables carry the tenant predicate. */
  scalar: <SubRow extends Record<string, unknown>, SubTables extends string>(
    build: (
      sub: ClickHouseReadStart<Scope, Ctes>,
    ) => ClickHouseRead<Scope, SubTables, SubRow, Ctes>,
  ) => Expression<SubRow[keyof SubRow], never>;
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

  /** The operations a clause is written with; a scalar reads its own table under this scope. */
  #ops(): ReadOps<Scope, Tables, Ctes> {
    const scope = this.#state.scope as Scope;
    const scalar: ReadOps<Scope, Tables, Ctes>["scalar"] = (build) => {
      const read = build(new ClickHouseReadStart<Scope, Ctes>(scope)).#state;
      const [only, ...rest] = read.select;
      if (only === undefined || rest.length > 0) {
        throw new QueryBuilderError({ kind: "scalar-not-one-value", selected: read.select.length });
      }
      const render = (context: RenderContext) =>
        `(${renderStatement({ state: read, context, nested: true, keys: undefined })})`;
      return expression({ kind: "scalar", render }, only.binding);
    };
    return { ...conditionOpsFor<Tables, Ctes>(), scalar };
  }

  /** The selection, or a function of the clause operations for `countIf`, `if` and the like. */
  select<Selection extends Record<string, Expression<unknown, Tables>>>(
    selection: Selection | ((ops: ReadOps<Scope, Tables, Ctes>) => Selection),
  ): ClickHouseRead<
    Scope,
    Tables,
    { [Key in keyof Selection]: ValueOfExpression<Selection[Key]> },
    Ctes
  > {
    const chosen = typeof selection === "function" ? selection(this.#ops()) : selection;
    return this.#next({
      select: Object.entries(chosen).map(([key, value]) => ({
        key,
        node: value.node,
        binding: value.binding,
      })),
    });
  }

  distinct(): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({ distinct: true });
  }

  /** PREWHERE conditions, on a one-table read; the tenant predicate stays in WHERE. */
  prewhere(
    build: (ops: ReadOps<Scope, Tables, Ctes>) => Condition<Tables>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    if (this.#state.joins.length > 0) throw new QueryBuilderError({ kind: "prewhere-in-join" });
    return this.#next({
      prewhere: [...this.#state.prewhere, build(this.#ops()).node],
    });
  }

  where(
    build: (ops: ReadOps<Scope, Tables, Ctes>) => Condition<Tables>,
    { inElection = true }: WhereOptions = {},
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const where = [...this.#state.where, build(this.#ops()).node];
    const { outerOnly } = this.#state;
    return this.#next({
      where,
      outerOnly: inElection ? outerOnly : [...outerOnly, where.length - 1],
    });
  }

  having(
    build: (ops: ReadOps<Scope, Tables, Ctes>) => Condition<Tables>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({
      having: [...this.#state.having, build(this.#ops()).node],
    });
  }

  /**
   * `latestVersion` elects the joined side's latest version inside its own subquery. A derived
   * side joins when it selects its tenant column (its own read carries the predicate), or when it
   * reads no tenant table, as a read of bound rows does: it then joins on `on` alone.
   */
  innerJoin<Name extends string, Columns extends ColumnsSpec>(
    table: ClickHouseTable<Name, Columns, "tenant" | "derived">,
    on: (ops: ConditionOps<Tables | Name, Ctes>) => Condition<Tables | Name>,
    options: JoinOptions = {},
  ): ClickHouseRead<Scope, Tables | Name, Row, Ctes> {
    return this.#join({ kind: "INNER", table: table.$table, options, on: on(conditionOpsFor()) });
  }

  leftJoin<Name extends string, Columns extends ColumnsSpec>(
    table: ClickHouseTable<Name, Columns, "tenant" | "derived">,
    on: (ops: ConditionOps<Tables | Name, Ctes>) => Condition<Tables | Name>,
    options: JoinOptions = {},
  ): ClickHouseRead<Scope, Tables | Name, Row, Ctes> {
    return this.#join({ kind: "LEFT", table: table.$table, options, on: on(conditionOpsFor()) });
  }

  #join<NextTables extends string>({
    kind,
    table,
    on,
    options,
  }: {
    kind: Join["kind"];
    table: ClickHouseTableFacts;
    on: Condition<string>;
    options: JoinOptions;
  }): ClickHouseRead<Scope, NextTables, Row, Ctes> {
    for (const side of [this.#state.table, table]) {
      const joinable =
        side.kind === "tenant" ||
        (side.kind === "derived" && (side.tenantColumn !== "" || !readsTenantTable(side)));
      if (!joinable) throw new QueryBuilderError({ kind: "unjoinable", table: side.name });
    }
    checkSource({ scope: this.#state.scope, table });
    const taken = [this.#state.table, ...this.#state.joins.map((each) => each.table)];
    if (taken.some((each) => each.name === table.name)) {
      throw new QueryBuilderError({ kind: "self-join", table: table.name });
    }
    if (this.#state.prewhere.length > 0 || this.#state.latestVersion === "prewhere") {
      throw new QueryBuilderError({ kind: "prewhere-in-join" });
    }
    if (options.latestVersion === true && table.versionColumn === undefined) {
      throw new QueryBuilderError({ kind: "no-version-column", table: table.name });
    }
    const join: Join = { kind, table, on: on.node, latestVersion: options.latestVersion === true };
    return this.#next({ joins: [...this.#state.joins, join] });
  }

  groupBy(...expressions: Expression<unknown, Tables>[]): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({
      groupBy: [...this.#state.groupBy, ...expressions.map((each) => each.node)],
    });
  }

  orderBy(
    target: Expression<unknown, Tables> | (keyof Row & string),
    direction: Direction = "ASC",
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const order = { target: typeof target === "string" ? target : target.node, direction };
    return this.#next({ orderBy: [...this.#state.orderBy, order] });
  }

  /** `LIMIT count BY …`: light key columns only, never heavy ones (clickhouse-queries.md). */
  limitBy(
    count: number,
    ...by: Expression<unknown, Tables>[]
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({ limitBy: { count: rowCount(count), by: by.map((each) => each.node) } });
  }

  limit(count: number): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({ limit: rowCount(count) });
  }

  offset(count: number): ClickHouseRead<Scope, Tables, Row, Ctes> {
    return this.#next({ offset: rowCount(count) });
  }

  /** A query-level `SETTINGS` clause on this SELECT; the scope's own settings are refused. */
  settings(
    values: Readonly<Record<string, number | string>>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    for (const [key, value] of Object.entries(values)) checkedSetting({ key, value });
    return this.#next({ settings: { ...this.#state.settings, ...values } });
  }

  /** `FINAL`, only where the sort key holds the tenant column, so versions never cross tenants. */
  final(): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const { table } = this.#state;
    if (table.kind !== "tenant" || !table.sortKey.includes(table.tenantColumn)) {
      throw new QueryBuilderError({ kind: "final-without-tenant-key", table: table.name });
    }
    return this.#next({ final: true });
  }

  /**
   * The IN-tuple election of keys and version (clickhouse-queries.md), in WHERE or `prewhere`.
   * `repeat` names the FROM table's columns stable per key; `version` the column the engine
   * replaces by, when it is not the descriptor's version column.
   */
  latestVersion({
    prewhere = false,
    repeat = [],
    version,
  }: {
    prewhere?: boolean;
    repeat?: readonly ColumnRef<Tables, string, unknown>[];
    version?: ColumnRef<Tables, string, unknown>;
  } = {}): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const { table } = this.#state;
    const elected = version === undefined ? undefined : electedVersionOf({ table, version });
    if (table.versionColumn === undefined && elected === undefined) {
      throw new QueryBuilderError({ kind: "no-version-column", table: table.name });
    }
    if (prewhere && this.#state.joins.length > 0)
      throw new QueryBuilderError({ kind: "prewhere-in-join" });
    const repeats = repeat.map(({ node }) => {
      const own =
        node.kind === "column" && node.table === table.name && node.name !== table.tenantColumn;
      if (own) return node.name;
      const column = node.kind === "column" ? `${node.table}.${node.name}` : node.kind;
      throw new QueryBuilderError({ kind: "repeat-outside-election", table: table.name, column });
    });
    return this.#next({
      latestVersion: prewhere ? "prewhere" : "where",
      repeats,
      version: elected,
    });
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

  /**
   * A common table expression read under the same scope, named for `oneOf(column, { cte })`; its
   * body may read the CTEs declared before it.
   */
  with<Name extends string, CteRow extends Record<string, unknown>, SubTables extends string>(
    name: Name,
    build: (
      sub: ClickHouseReadStart<Scope, Ctes>,
    ) => ClickHouseRead<Scope, SubTables, CteRow, Ctes>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes & Record<Name, CteRow[keyof CteRow]>> {
    const tables = [this.#state.table, ...this.#state.joins.map((join) => join.table)];
    const taken = new Set([
      ...tables.flatMap((table) => [table.name, ...table.columns]),
      ...this.#state.ctes.map((cte) => cte.name),
    ]);
    if (!IDENTIFIER.test(name) || taken.has(name)) {
      throw new QueryBuilderError({ kind: "bad-cte-name", name });
    }
    const read = build(new ClickHouseReadStart<Scope, Ctes>(this.#state.scope as Scope)).#state;
    return this.#next({ ctes: [...this.#state.ctes, { name, read }] });
  }

  /**
   * A UNION ALL arm under the same scope, selecting the read's keys. An arm may carry its own
   * WITH, order and limit; the read's own order and limit then apply to the whole union.
   */
  unionAll<ArmTables extends string, ArmCtes extends Record<string, unknown>>(
    build: (arm: ClickHouseReadStart<Scope>) => ClickHouseRead<Scope, ArmTables, Row, ArmCtes>,
  ): ClickHouseRead<Scope, Tables, Row, Ctes> {
    const arm = build(new ClickHouseReadStart(this.#state.scope as Scope)).#state;
    return this.#next({ arms: [...this.#state.arms, arm] });
  }

  /**
   * This read as a table another read under the same scope selects from: `FROM (…) AS alias`. It
   * keeps a tenant column, and so may be a join side, when it selects its source's as itself.
   */
  as<const Alias extends string>(
    alias: Alias,
  ): ClickHouseTable<Alias, DerivedColumns<Row>, "derived"> {
    if (!IDENTIFIER.test(alias)) throw new QueryBuilderError({ kind: "bad-alias", name: alias });
    const { select, table } = this.#state;
    if (select.length === 0) throw new QueryBuilderError({ kind: "empty-select" });
    const keepsTenant = [this.#state, ...this.#state.arms].every(selectsOwnTenant);
    const facts: ClickHouseTableFacts = {
      kind: "derived",
      name: alias,
      stored: alias,
      tenantColumn: keepsTenant ? table.tenantColumn : "",
      timeColumn: undefined,
      versionColumn: undefined,
      sortKey: [],
      columns: select.map((each) => each.key),
    };
    DERIVED.set(facts, this.#state);
    const refs = Object.fromEntries(
      select.map((each) => [
        each.key,
        refOf({ table: alias, stored: alias, name: each.key, binding: each.binding }),
      ]),
    );
    return { ...refs, $table: facts } as ClickHouseTable<Alias, DerivedColumns<Row>, "derived">;
  }

  build(): StatementOf<Scope, Row> {
    const context = renderContext();
    const sql = renderStatement({ state: this.#state, context, nested: false, keys: undefined });
    refuseOverBudget({ statement: sql, params: context.params });
    const { scope } = this.#state;
    if (scope.kind !== "serverMetadata" && context.tenantColumns.size === 0) {
      throw new QueryBuilderError({ kind: "no-tenant-table" });
    }
    const { params } = context;
    let statement: ClickHouseReadStatement<Row> | MetadataReadStatement<Row>;
    if (scope.kind === "allTenants") {
      const settings = { ...PINNED_SETTINGS };
      statement = {
        identity: "system",
        kind: "allTenants",
        sql,
        params,
        settings,
        reason: scope.reason,
      };
    } else if (scope.kind === "serverMetadata") {
      const settings = { ...PINNED_SETTINGS };
      statement = {
        identity: "reader",
        kind: "metadata",
        sql,
        params,
        settings,
        reason: scope.reason,
      };
    } else {
      statement = readerStatement({
        scope,
        sql,
        params,
        tenantColumns: [...context.tenantColumns].toSorted(),
      });
    }
    // The scope's kind decided the statement above; the conditional type restates it.
    return statement as StatementOf<Scope, Row>;
  }
}

function readerStatement<Row>({
  scope,
  sql,
  params,
  tenantColumns,
}: {
  scope: ReaderScope;
  sql: string;
  params: Record<string, unknown>;
  tenantColumns: readonly string[];
}): ReaderReadStatement<Row> {
  return {
    identity: "reader",
    kind: "tenant",
    sql,
    params,
    settings: { ...PINNED_SETTINGS, [TENANT_IDS_SETTING]: scope.tenantIds.join(",") },
    tenantId: scope.tenantId,
    tenantIds: scope.kind === "single" ? undefined : scope.tenantIds,
    routeTenantId: scope.routeTenantId,
    tenantColumns,
    expiresAt: scope.kind === "proof" ? scope.expiresAt : undefined,
  };
}

type Render = {
  state: ReadState;
  context: RenderContext;
  /** The union's key order an arm selects in; undefined for a read's own selection. */
  keys: readonly string[] | undefined;
};

function renderStatement({ state, context, nested, keys }: Render & { nested: boolean }): string {
  if (nested && (state.ctes.length > 0 || state.arms.length > 0)) {
    throw new QueryBuilderError({ kind: "nested-with" });
  }
  const parts: string[] = [];
  const enclosing = context.ctes.visible;
  try {
    // Each CTE body reads the CTEs before it; the body reads them all; none outlives its WITH.
    if (state.ctes.length > 0) {
      const ctes = state.ctes.map((cte) => {
        const body = renderStatement({ state: cte.read, context, nested: true, keys: undefined });
        context.ctes.visible = new Set([...context.ctes.visible, cte.name]);
        return `${cte.name} AS (${body})`;
      });
      parts.push(`WITH ${ctes.join(", ")}`);
    }
    parts.push(renderBody({ state, context, keys }));
  } finally {
    context.ctes.visible = enclosing;
  }
  return parts.join(" ");
}

const isOrdered = (state: ReadState): boolean =>
  state.orderBy.length > 0 ||
  state.limitBy !== undefined ||
  state.limit !== undefined ||
  state.offset !== undefined;

/** A read and its arms; an ordered or limited union is wrapped so the order covers every arm. */
function renderBody({ state, context, keys }: Render): string {
  if (state.arms.length === 0) return renderSelect({ state, context, keys });
  refuseSettingsInUnion(state);
  const order = keys ?? state.select.map((each) => each.key);
  const ordered = isOrdered(state);
  const head = ordered
    ? { ...state, orderBy: [], limitBy: undefined, limit: undefined, offset: undefined }
    : state;
  const arms = state.arms.map((arm) => {
    if (arm.arms.length > 0) throw new QueryBuilderError({ kind: "ordered-union" });
    const text = renderStatement({ state: arm, context, nested: false, keys: order });
    return arm.ctes.length > 0 || isOrdered(arm) ? `UNION ALL (${text})` : `UNION ALL ${text}`;
  });
  const union = [renderSelect({ state: head, context, keys }), ...arms].join(" ");
  if (!ordered) return union;
  if (state.limitBy !== undefined) throw new QueryBuilderError({ kind: "bad-union-order" });
  const orders = state.orderBy.map(({ target, direction }) => {
    if (typeof target !== "string" || !order.includes(target)) {
      throw new QueryBuilderError({ kind: "bad-union-order" });
    }
    return `${target} ${direction}`;
  });
  return [
    `SELECT ${order.join(", ")} FROM (${union})`,
    orders.length > 0 ? `ORDER BY ${orders.join(", ")}` : "",
    state.limit === undefined ? "" : `LIMIT ${state.limit}`,
    state.offset === undefined ? "" : `OFFSET ${state.offset}`,
  ]
    .filter((clause) => clause !== "")
    .join(" ");
}

/** Every expression a read holds, for its column checks and its join sides' projections. */
const nodesOf = (state: ReadState): ExpressionNode[] => [
  ...state.select.map((each) => each.node),
  ...state.prewhere,
  ...state.where,
  ...state.groupBy,
  ...state.having,
  ...state.joins.map((join) => join.on),
  ...state.orderBy.flatMap(({ target }) => (typeof target === "string" ? [] : [target])),
  ...(state.limitBy?.by ?? []),
];

/** One SELECT: its own scope predicate on every table it reads, then the caller's clauses. */
function renderSelect({ state, context, keys }: Render): string {
  const tables = [state.table, ...state.joins.map((join) => join.table)];
  const qualify = state.joins.length > 0;
  const render = (node: ExpressionNode) => renderExpression({ node, context, qualify });
  refuseForeignColumns({ state, tables });
  if (qualify && [...state.where, ...state.having].some(holdsIdBound)) {
    throw new QueryBuilderError({ kind: "id-bound-in-join" });
  }
  const selection = selectionOf({ state, tables, keys });

  const list = selection.map(({ key, node }) => {
    const rendered = render(node);
    const bare = node.kind === "column" && node.name === key && !qualify;
    return bare ? rendered : `${rendered} AS ${key}`;
  });
  const source = sourceOf({ state, context });
  const { prewhere, where } = filtersOf({ state, context, render, predicate: source.predicate });
  const clauses = [
    `SELECT ${state.distinct ? "DISTINCT " : ""}${list.join(", ")}`,
    source.from === undefined ? "" : `FROM ${source.from}`,
    prewhere.length > 0 ? `PREWHERE ${prewhere.join(" AND ")}` : "",
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    ...tailClausesOf({ state, selection, render }),
  ];
  return clauses.filter((clause) => clause !== "").join(" ");
}

/** PREWHERE and WHERE: the scope's predicate first, then the caller's, then any election. */
function filtersOf({
  state,
  context,
  render,
  predicate,
}: {
  state: ReadState;
  context: RenderContext;
  render: (node: ExpressionNode) => string;
  predicate: string | undefined;
}): { prewhere: string[]; where: string[] } {
  const election =
    state.latestVersion !== undefined && state.joins.length === 0
      ? electionOf({ state, table: state.table, context })
      : undefined;
  const elected = (clause: "where" | "prewhere") =>
    state.latestVersion === clause && election !== undefined ? [election] : [];
  return {
    prewhere: [...state.prewhere.map(render), ...elected("prewhere")],
    where: [
      ...(predicate === undefined ? [] : [predicate]),
      ...state.where.map(render),
      ...elected("where"),
    ],
  };
}

/** GROUP BY, HAVING, ORDER BY, LIMIT BY, LIMIT and OFFSET, each empty when not asked for. */
function tailClausesOf({
  state,
  selection,
  render,
}: {
  state: ReadState;
  selection: readonly Selected[];
  render: (node: ExpressionNode) => string;
}): string[] {
  const { limitBy } = state;
  return [
    state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.map(render).join(", ")}` : "",
    state.having.length > 0 ? `HAVING ${state.having.map(render).join(" AND ")}` : "",
    orderClauseOf({ state, selection, render }),
    limitBy === undefined ? "" : `LIMIT ${limitBy.count} BY ${limitBy.by.map(render).join(", ")}`,
    state.limit === undefined ? "" : `LIMIT ${state.limit}`,
    state.offset === undefined ? "" : `OFFSET ${state.offset}`,
    settingsClauseOf(state),
  ];
}

/** The FROM clause, and the scope's predicate on a one-table read; join sides carry their own. */
function sourceOf({ state, context }: { state: ReadState; context: RenderContext }): {
  from: string | undefined;
  predicate: string | undefined;
} {
  const { table } = state;
  if (table === NO_TABLE) return { from: undefined, predicate: undefined };
  if (state.joins.length === 0) {
    const derived = derivedSide({ table, context }) ?? boundRowsSource({ table, context });
    if (derived !== undefined) return { from: derived, predicate: undefined };
    const alias = table.name === table.stored ? "" : ` AS ${table.name}`;
    return {
      from: `${table.stored}${alias}${state.final ? " FINAL" : ""}`,
      predicate: tenantPredicate({ state, table, context, election: false }),
    };
  }
  // The FROM side binds its parameters before the joined sides, in text order.
  const first =
    derivedSide({ table, context }) ??
    joinSide({
      state,
      table,
      context,
      final: state.final,
      latestVersion: state.latestVersion !== undefined,
    });
  const joined = state.joins.map((join) => {
    const left = `${table.name}.${table.tenantColumn}`;
    const right = `${join.table.name}.${join.table.tenantColumn}`;
    const side =
      derivedSide({ table: join.table, context }) ??
      joinSide({
        state,
        table: join.table,
        context,
        final: false,
        latestVersion: join.latestVersion,
      });
    const on = renderExpression({ node: join.on, context, qualify: true });
    // A side with no tenant column reads no tenant table (`#join`): there is no tenant to match.
    const both = table.tenantColumn !== "" && join.table.tenantColumn !== "";
    return `${join.kind} JOIN ${side} ON ${both ? `${left} = ${right} AND ` : ""}${on}`;
  });
  return { from: [first, ...joined].join(" "), predicate: undefined };
}

function orderClauseOf({
  state,
  selection,
  render,
}: {
  state: ReadState;
  selection: readonly Selected[];
  render: (node: ExpressionNode) => string;
}): string {
  if (state.orderBy.length === 0) return "";
  const keys = new Set(selection.map(({ key }) => key));
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
  for (const { table, name } of nodesOf(state).flatMap(columnsOf)) {
    if (!tables.some((each) => each.name === table)) {
      throw new QueryBuilderError({ kind: "foreign-column", table, column: name });
    }
  }
}

/**
 * The selection in the order asked for, refusing an alias that would shadow a column of a tenant
 * table the read names: the scope predicate reads those columns by their bare names.
 */
function selectionOf({
  state,
  tables,
  keys,
}: {
  state: ReadState;
  tables: readonly ClickHouseTableFacts[];
  keys: readonly string[] | undefined;
}): Selected[] {
  if (state.select.length === 0) throw new QueryBuilderError({ kind: "empty-select" });
  const declared = new Set(
    tables.filter((table) => table.kind === "tenant").flatMap((table) => table.columns),
  );
  for (const { key, node } of state.select) {
    if (!IDENTIFIER.test(key)) throw new QueryBuilderError({ kind: "bad-alias", name: key });
    const same = node.kind === "column" && node.name === key;
    if (declared.has(key) && !same)
      throw new StatementScopeError({ kind: "shadowing-alias", name: key });
  }
  if (keys === undefined) return [...state.select];
  const received = new Map(state.select.map((each) => [each.key, each]));
  const ordered = keys.flatMap((key) => {
    const each = received.get(key);
    return each === undefined ? [] : [each];
  });
  if (ordered.length !== keys.length || received.size !== keys.length) {
    throw new QueryBuilderError({
      kind: "union-mismatch",
      expected: keys.join(", "),
      received: [...received.keys()].join(", "),
    });
  }
  return ordered;
}

/** Whether a derived table's text reads a tenant table anywhere: a source, a CTE or a scalar. */
function readsTenantTable(table: ClickHouseTableFacts): boolean {
  const read = DERIVED.get(table);
  if (read === undefined) return true;
  const context = renderContext();
  try {
    renderStatement({ state: read, context, nested: false, keys: undefined });
  } catch {
    // A read that does not render is not shown to read no tenant table; its own render refuses it.
    return true;
  }
  return context.tenantColumns.size > 0;
}

/** A derived join side: its own read, whose text carries the scope's predicate on its tables. */
function derivedSide({
  table,
  context,
}: {
  table: ClickHouseTableFacts;
  context: RenderContext;
}): string | undefined {
  if (table.kind !== "derived") return undefined;
  // Only `as` makes a derived table; one it did not make has no read to carry the predicate.
  const derived = DERIVED.get(table);
  if (derived === undefined) throw new QueryBuilderError({ kind: "foreign-scope" });
  const body = renderStatement({ state: derived, context, nested: false, keys: undefined });
  return `(${body}) AS ${table.name}`;
}

/** A join side: a scoped subquery projecting its tenant column and every column read of it. */
function joinSide({
  state,
  table,
  context,
  final,
  latestVersion,
}: {
  state: ReadState;
  table: ClickHouseTableFacts;
  context: RenderContext;
  final: boolean;
  latestVersion: boolean;
}): string {
  const read = new Set(
    nodesOf(state)
      .flatMap(columnsOf)
      .filter((each) => each.table === table.name)
      .map((each) => each.name),
  );
  const projected = table.columns.filter((name) => name === table.tenantColumn || read.has(name));
  const where = [
    tenantPredicate({ state, table, context, election: false }),
    ...(latestVersion ? [electionOf({ state, table, context })] : []),
  ].filter((each) => each !== undefined);
  const filter = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const stored = `${table.stored}${final ? " FINAL" : ""}`;
  return `(SELECT ${projected.join(", ")} FROM ${stored}${filter}) AS ${table.name}`;
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
  // A derived table's own read carries the predicate; a system table holds no tenant rows.
  if (table.kind !== "tenant") return undefined;
  context.tenantColumns.add(table.tenantColumn);
  switch (scope.kind) {
    case "allTenants":
    case "serverMetadata":
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
        : { kind: tenancy.held.kind, param: paramNameOf({ node: tenancy.held.node, context }) };
    expression = conditionsExpression({ fence, column, held });
  }
  Object.assign(context.params, expression.params);
  return expression.sql;
}

/**
 * The conditions an election repeats: conjuncts on the table's keys or time column alone (the
 * window keeps partition pruning), id bounds and terms reading a declared `repeat` column. An
 * outer-only `where` never repeats.
 */
function repeatedConditionsOf({
  state,
  table,
}: {
  state: ReadState;
  table: ClickHouseTableFacts;
}): ExpressionNode[] {
  const repeats = table === state.table ? state.repeats : [];
  const onKeys = (name: string) => table.sortKey.includes(name) || name === table.timeColumn;
  const stable = (name: string) => onKeys(name) || repeats.includes(name);
  // An id bound on any of the table's own columns repeats too, as the raw reads repeat it.
  const repeatsTerm = (node: ExpressionNode) =>
    (node.kind === "idBound" && readsOnly({ node, table, allowed: () => true })) ||
    (columnsOf(node).some((each) => repeats.includes(each.name)) &&
      readsOnly({ node, table, allowed: stable }));
  const termsOf = (node: ExpressionNode): ExpressionNode[] => {
    if (repeatsTerm(node)) return [node];
    return node.kind === "logic" && node.operator === "AND" ? node.terms.flatMap(termsOf) : [];
  };
  const outer = new Set(state.outerOnly);
  return [...state.prewhere, ...state.where.filter((_, index) => !outer.has(index))].flatMap(
    (node) => (readsOnly({ node, table, allowed: onKeys }) ? [node] : termsOf(node)),
  );
}

/** Whether a condition reads columns, each one of the table's own, non-tenant and `allowed`. */
function readsOnly({
  node,
  table,
  allowed,
}: {
  node: ExpressionNode;
  table: ClickHouseTableFacts;
  allowed: (name: string) => boolean;
}): boolean {
  const read = columnsOf(node);
  return (
    read.length > 0 &&
    read.every(
      (each) => each.table === table.name && each.name !== table.tenantColumn && allowed(each.name),
    )
  );
}

/** The latest-version election: keys and version from the descriptor, under the fence's form. */
function electionOf({
  state,
  table,
  context,
}: {
  state: ReadState;
  table: ClickHouseTableFacts;
  context: RenderContext;
}): string {
  // A join side elects on its descriptor's version; the FROM side on the read's, when it names one.
  const version = (table === state.table ? state.version : undefined) ?? table.versionColumn ?? "";
  const keys = table.sortKey;
  const where: string[] = [];
  const predicate = tenantPredicate({ state, table, context, election: true });
  if (predicate !== undefined) where.push(predicate);
  for (const node of repeatedConditionsOf({ state, table })) {
    where.push(renderExpression({ node, context, qualify: false }));
  }
  const filter = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  return (
    `(${[...keys, version].join(", ")}) IN (SELECT ${keys.join(", ")}, max(${version}) FROM ${table.stored}` +
    `${filter} GROUP BY ${keys.join(", ")})`
  );
}
