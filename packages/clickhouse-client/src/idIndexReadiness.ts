/**
 * Whether an owner's id indexes may be trusted on a ClickHouse target, from a marker row in each
 * index (id-index plan §2): the fill writes it once a target is filled, and a reader writes it
 * itself over an empty source, since the view, created before serve, already catches every row.
 */
import { assertIdentifier, type IdIndexFlags, SHARED_CLICKHOUSE_TARGET } from "./idIndexFlags.ts";
import type { QueryRequest, QueryResult } from "./query.ts";

/** The value of every key column of the marker row; its `TenantId` is `''`, which no tenant has. */
export const ID_INDEX_FILL_MARKER = "__fill_complete__";

/** How long a target found not ready waits before the next background check. */
export const ID_INDEX_READINESS_RECHECK_MS = 60_000;

/** The marker row is kept forever: the index's highest retention, as the TTL reads it. */
const MARKER_RETENTION_DAYS = 65_535;

/** One index whose marker is read and written: an `IdIndexDeclaration` satisfies it. */
export type IdIndexMarkerTable = Readonly<{
  source: string;
  index: string;
  key: readonly string[];
  filter?: string | undefined;
}>;

/** Where the marker statements go: the routed client. */
export interface IdIndexMarkerStatements {
  query<Row>(request: QueryRequest): Promise<QueryResult<Row>>;
  command(request: QueryRequest): Promise<void>;
}

/** Routes a statement to a readiness target: `"shared"`, or a private route's organisation. */
export function idIndexTargetRoute({
  target,
}: {
  target: string;
}): Pick<QueryRequest, "tenantId" | "organizationId"> {
  return target === SHARED_CLICKHOUSE_TARGET
    ? { tenantId: "" }
    : { tenantId: "", organizationId: target };
}

function markerMatch({ table }: { table: IdIndexMarkerTable }): string {
  const keys = table.key.map((column) => `${assertIdentifier({ name: column })} = {marker:String}`);
  return ["TenantId = ''", ...keys].join(" AND ");
}

/** Whether the target holds the index's marker row. */
export async function hasIdIndexMarker({
  statements,
  route,
  table,
}: {
  statements: IdIndexMarkerStatements;
  route: Pick<QueryRequest, "tenantId" | "organizationId">;
  table: IdIndexMarkerTable;
}): Promise<boolean> {
  const { rows } = await statements.query<{ ready: number }>({
    ...route,
    sql: `SELECT 1 AS ready FROM ${assertIdentifier({ name: table.index })} WHERE ${markerMatch({ table })} LIMIT 1`,
    params: { marker: ID_INDEX_FILL_MARKER },
    table: table.index,
    kind: "read",
    // The marker row belongs to no tenant: its TenantId is '', which no real tenant has.
    SKIP_TENANT_CHECK: true,
  });
  return rows.length > 0;
}

/** Writes the index's marker row on the target; writing it twice merges into one row. */
export async function writeIdIndexMarker({
  statements,
  route,
  table,
}: {
  statements: IdIndexMarkerStatements;
  route: Pick<QueryRequest, "tenantId" | "organizationId">;
  table: IdIndexMarkerTable;
}): Promise<void> {
  const keys = table.key.map((column) => assertIdentifier({ name: column }));
  await statements.command({
    ...route,
    sql:
      `INSERT INTO ${assertIdentifier({ name: table.index })} (TenantId, ${keys.join(", ")}, _retention_days) ` +
      `VALUES ('', ${keys.map(() => "{marker:String}").join(", ")}, ${MARKER_RETENTION_DAYS})`,
    params: { marker: ID_INDEX_FILL_MARKER },
    table: table.index,
    kind: "write",
    // The marker row belongs to no tenant: its TenantId is '', which no real tenant has.
    SKIP_TENANT_CHECK: true,
  });
}

/** Whether the index's source holds no row the index would keep, on the target. */
async function sourceIsEmpty({
  statements,
  route,
  table,
}: {
  statements: IdIndexMarkerStatements;
  route: Pick<QueryRequest, "tenantId" | "organizationId">;
  table: IdIndexMarkerTable;
}): Promise<boolean> {
  const where = table.filter === undefined ? "" : ` WHERE (${table.filter})`;
  const { rows } = await statements.query<{ found: number }>({
    ...route,
    sql: `SELECT 1 AS found FROM ${assertIdentifier({ name: table.source })}${where} LIMIT 1`,
    table: table.source,
    kind: "read",
    // Asks whether any tenant has a row at all; it returns no tenant's data.
    SKIP_TENANT_CHECK: true,
    // Stops at the first row of any partition; only an empty table reads every part.
    SKIP_COLD_SCAN_CHECK: true,
  });
  return rows.length === 0;
}

/** Whether a statement is a readiness check or a marker write, so a recording double skips it. */
export function isIdIndexReadinessStatement({ sql }: { sql: string }): boolean {
  return sql.includes("{marker:String}") || sql.startsWith("SELECT 1 AS found FROM ");
}

type TargetState = { ready: boolean; pending: Promise<boolean> | undefined; checkedAt: number };

/** Every target a routed client answers for: `"shared"`, then each private organisation. */
export function idIndexReadinessTargets({
  privateRoutes,
}: {
  privateRoutes: ReadonlyMap<string, string>;
}): string[] {
  return [SHARED_CLICKHOUSE_TARGET, ...[...privateRoutes.keys()].toSorted()];
}

/**
 * An owner's id-index readiness per target, answered from memory: `isOn` never waits on I/O. The
 * `watch` targets are checked at boot, before a fresh install's first row; any other target on its
 * first ask. A target not ready is re-checked at most every 60 s, a ready one never again.
 */
export class IdIndexReadiness implements IdIndexFlags {
  static create({
    statements,
    indexes,
    watch,
    recheckMs = ID_INDEX_READINESS_RECHECK_MS,
    now = () => performance.now(),
  }: {
    statements: IdIndexMarkerStatements;
    indexes: readonly IdIndexMarkerTable[];
    /** The targets checked at once, in the background; a failure leaves each to its first ask. */
    watch?: () => Promise<readonly string[]> | readonly string[];
    recheckMs?: number;
    now?: () => number;
  }): IdIndexReadiness {
    const readiness = new IdIndexReadiness({ statements, indexes, recheckMs, now });
    if (watch !== undefined) void readiness.checkEach({ targets: watch });
    return readiness;
  }

  private readonly states = new Map<string, TargetState>();

  private readonly statements: IdIndexMarkerStatements;
  private readonly indexes: readonly IdIndexMarkerTable[];
  private readonly recheckMs: number;
  private readonly now: () => number;

  private constructor(options: {
    statements: IdIndexMarkerStatements;
    indexes: readonly IdIndexMarkerTable[];
    recheckMs: number;
    now: () => number;
  }) {
    this.statements = options.statements;
    this.indexes = options.indexes;
    this.recheckMs = options.recheckMs;
    this.now = options.now;
  }

  isOn({ target }: { target: string }): boolean {
    const state = this.states.get(target);
    if (state?.ready === true) return true;
    if (
      state === undefined ||
      (state.pending === undefined && this.now() - state.checkedAt >= this.recheckMs)
    ) {
      void this.check({ target });
    }
    return false;
  }

  private async checkEach({
    targets,
  }: {
    targets: () => Promise<readonly string[]> | readonly string[];
  }): Promise<void> {
    try {
      for (const target of await targets()) await this.check({ target });
    } catch {
      // The targets could not be listed; each is checked on its first ask instead.
    }
  }

  /** Checks one target now, or joins the check in flight, and remembers the answer. */
  check({ target }: { target: string }): Promise<boolean> {
    const state = this.states.get(target) ?? { ready: false, pending: undefined, checkedAt: 0 };
    this.states.set(target, state);
    if (state.ready) return Promise.resolve(true);
    if (state.pending !== undefined) return state.pending;
    state.checkedAt = this.now();
    state.pending = this.allReady({ route: idIndexTargetRoute({ target }) })
      // A failed check (an index not created yet, a server away) reads as not ready.
      .catch(() => false)
      .then((ready) => {
        state.ready = ready;
        state.pending = undefined;
        state.checkedAt = this.now();
        return ready;
      });
    return state.pending;
  }

  private async allReady({
    route,
  }: {
    route: Pick<QueryRequest, "tenantId" | "organizationId">;
  }): Promise<boolean> {
    const { statements } = this;
    for (const table of this.indexes) {
      if (await hasIdIndexMarker({ statements, route, table })) continue;
      if (!(await sourceIsEmpty({ statements, route, table }))) return false;
      await writeIdIndexMarker({ statements, route, table });
    }
    return true;
  }
}
