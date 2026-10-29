/**
 * The composition core: one class running policies in a fixed, load-bearing
 * order (tenant guard, tracing, concurrency limit, reporting, retry). Concurrency
 * sits outside retry — a slot must survive a retry, or a small overload turns persistent.
 */

import { hasIdBound, type IdBound, idBoundOf, IdIndexRegistry, readIdBound } from "./idBound.ts";
import {
  type IdIndexBounds,
  type IdIndexDeclaration,
  idIndexBoundsOf,
  idIndexBoundsStatement,
  type IdIndexLookup,
  SHARED_CLICKHOUSE_TARGET,
} from "./idIndexFlags.ts";
import {
  coalesceKeyOf,
  DEFAULT_INSERT_COALESCE_MAX_ROWS,
  InsertCoalescer,
} from "./insert-coalescing.ts";
import type {
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
} from "./managed-client.ts";
import { CLICKHOUSE_COLUMNS_QUERY, ClickHouseColumns } from "./present-columns.ts";
import type { InsertRequest, QueryDriver, QueryRequest, QueryResult } from "./query.ts";
import { TRANSIENT_NETWORK_CODES } from "./resilience.ts";
import type { RetryPolicy } from "./retry.ts";
import type { StatementOperation, StatementReporter } from "./statementReporting.ts";
import { ID_BOUND_PARAM_PREFIX, StatementScopeError } from "./statementScopeError.ts";
import { extractQueryType, extractTableName } from "./statementShape.ts";
import type { PrivateRouteVariable } from "./tenancy.ts";
import type { TenantGuard } from "./tenantGuard.ts";
import type { QueryTracer } from "./tracing.ts";

export interface ClickHouseQueryClientOptions {
  /** The only collaborator that talks to a server. */
  driver: QueryDriver;
  /** Refuses statements with no tenant predicate unless they set `SKIP_TENANT_CHECK`. */
  tenantGuard: TenantGuard;
  /** Records a span per statement. Omit to record none. */
  tracer?: QueryTracer | undefined;
  /** Bounds statements in flight; refuses as overloaded on a full queue or an outlasted wait. */
  limiter?: ClickHouseStatementAdmission | undefined;
  /** Retries transient failures. Omit to try exactly once. */
  retries?: RetryPolicy | undefined;
  /** Logs and counts each read and write once its retries settle, cold scans included. */
  reporter?: StatementReporter | undefined;
  /** The routing table's private routes, organization id to endpoint; none by default. */
  privateRoutes?: ReadonlyMap<string, string> | undefined;
  /** Every private route variable this process parsed, usable or not; none by default. */
  privateRouteVariables?: readonly PrivateRouteVariable[] | undefined;
  /** The organisation a tenant belongs to, from the router's cache; needed once a route exists. */
  organizationOf?: ((tenantId: string) => Promise<string>) | undefined;
  /** Builds the handled refusal for a read whose server stopped answering; raw by default. */
  unavailableErrorFactory?: ClickHouseUnavailableErrorFactory | undefined;
  /** Builds the handled refusal for a read the server refused as overloaded; raw by default. */
  overloadErrorFactory?: ClickHouseOverloadErrorFactory | undefined;
  /**
   * Rows one coalesced async insert carries at most (ADR-187); 0 sends every insert alone.
   * Coalescing needs a limiter: with none, nothing ever waits for a slot.
   */
  insertCoalesceMaxRows?: number | undefined;
}

/** The handled refusal for a read whose server did not answer once retries ran out. */
export abstract class ClickHouseUnavailableErrorFactory {
  abstract create(input: { cause: Error }): unknown;
}

/** A connection that failed or dropped (`socket hang up` is ECONNRESET), never a server error. */
function isConnectionFailure(error: unknown): error is Error {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code);
}

/** ClickHouse's own overload refusal: TOO_MANY_SIMULTANEOUS_QUERIES (202). */
const SERVER_OVERLOAD_CODES: ReadonlySet<string> = new Set(["202"]);

function isServerOverload(error: unknown): error is Error {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && typeof code === "string" && SERVER_OVERLOAD_CODES.has(code);
}

const now = (): number => globalThis.performance.now();

/**
 * A refused connection is the one insert failure that provably sent nothing: no socket opened,
 * so no row can have landed. Anything later (a reset, a hang up, a cancelled query, a timeout)
 * may have written the batch, and with no insert dedup token a retry in place would write it twice.
 */
function wasRefusedBeforeSending(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ECONNREFUSED";
}

/** Carries an insert failure past the retry policy untouched, so it is not retried in place. */
class InsertNotRetriedInPlace extends Error {
  constructor(readonly failure: unknown) {
    super("insert not retried in place");
  }
}

export class ClickHouseQueryClient {
  private readonly driver: QueryDriver;
  private readonly tenantGuard: TenantGuard;
  private readonly tracer: QueryTracer | undefined;
  private readonly limiter: ClickHouseStatementAdmission | undefined;
  private readonly retries: RetryPolicy | undefined;
  private readonly reporter: StatementReporter | undefined;
  private readonly routes: ReadonlyMap<string, string>;
  private readonly routeVariables: readonly PrivateRouteVariable[];
  private readonly organizationOf: ((tenantId: string) => Promise<string>) | undefined;
  private readonly columnLists = new Map<string, ClickHouseColumns>();
  private readonly unavailable: ClickHouseUnavailableErrorFactory | undefined;
  private readonly overloaded: ClickHouseOverloadErrorFactory | undefined;
  private readonly idIndexRegistry: IdIndexRegistry;
  private readonly coalescer: InsertCoalescer<InsertRequest> | undefined;

  constructor({
    driver,
    tenantGuard,
    tracer,
    limiter,
    retries,
    reporter,
    privateRoutes,
    privateRouteVariables,
    unavailableErrorFactory,
    overloadErrorFactory,
    organizationOf,
    insertCoalesceMaxRows,
  }: ClickHouseQueryClientOptions) {
    this.driver = driver;
    this.tenantGuard = tenantGuard;
    this.tracer = tracer;
    this.limiter = limiter;
    this.retries = retries;
    this.reporter = reporter;
    this.routes = privateRoutes ?? new Map();
    this.routeVariables = privateRouteVariables ?? [];
    this.unavailable = unavailableErrorFactory;
    this.overloaded = overloadErrorFactory;
    this.organizationOf = organizationOf;
    this.idIndexRegistry = new IdIndexRegistry(this);
    this.coalescer =
      limiter === undefined
        ? undefined
        : new InsertCoalescer<InsertRequest>(
            {
              admitsNow: () => limiter.admitsNow("insert"),
              admit: (task, callers) => limiter.run({ operation: "insert", task, callers }),
              send: (requests) => this.sendInsert(coalescedRequest(requests)),
            },
            insertCoalesceMaxRows ?? DEFAULT_INSERT_COALESCE_MAX_ROWS,
          );
  }

  /**
   * Declares id indexes once, at composition: from then on a statement's `{{idBound}}` marker
   * over one of them is bounded by it, and its readiness is checked on every target.
   */
  declareIdIndexes({ indexes }: { indexes: readonly IdIndexDeclaration[] }): void {
    this.idIndexRegistry.declare({ indexes });
  }

  /** The declared id indexes and their readiness, for the fenced reader and the fill. */
  idIndexes(): IdIndexRegistry {
    return this.idIndexRegistry;
  }

  /**
   * The target a tenant's statements land on: `"shared"`, with no I/O while no private route
   * exists, else its organisation when that has a route. Keys an owner's id-index readiness.
   */
  async targetOf({ tenantId }: { tenantId: string }): Promise<string> {
    if (this.routes.size === 0) return SHARED_CLICKHOUSE_TARGET;
    if (this.organizationOf === undefined) {
      throw new Error("A client with private routes cannot name a tenant's target without them.");
    }
    const organizationId = await this.organizationOf(tenantId);
    return this.routes.has(organizationId) ? organizationId : SHARED_CLICKHOUSE_TARGET;
  }

  /**
   * One point read of an id index: for one tenant, or for a declared tenant set (a fenced
   * read's own and shared projects), so a shared grant's ids are found too.
   */
  async indexBounds({
    tenantId,
    tenantIds,
    ...lookup
  }: IdIndexLookup & {
    tenantId: string;
    tenantIds?: readonly string[] | undefined;
  }): Promise<IdIndexBounds> {
    const statement = idIndexBoundsStatement({
      ...lookup,
      tenantPredicate:
        tenantIds === undefined
          ? "TenantId = {tenantId:String}"
          : `TenantId IN ({${ID_BOUND_PARAM_PREFIX}_tenants:Array(String)})`,
    });
    const tenants =
      tenantIds === undefined
        ? { params: { tenantId } }
        : {
            params: { [`${ID_BOUND_PARAM_PREFIX}_tenants`]: [...tenantIds] },
            tenantIds,
          };
    const result = await this.statement<unknown>({
      tenantId,
      ...(tenants.tenantIds === undefined ? {} : { tenantIds: tenants.tenantIds }),
      sql: statement.sql,
      params: { ...statement.params, ...tenants.params },
      table: lookup.index,
    });
    return idIndexBoundsOf({ rows: result.rows });
  }

  /**
   * The organizations this client routes to a private endpoint, parsed once at boot. A
   * deployment fact a peer reads (cohort exclusion) without declaring the env family again.
   */
  privateRoutes(): ReadonlyMap<string, string> {
    return this.routes;
  }

  /** Each private route variable by name and label, and whether it parsed; never its value. */
  privateRouteVariables(): readonly PrivateRouteVariable[] {
    return this.routeVariables;
  }

  /**
   * The column list of the target `tenantId` routes to, for a read naming a column a pending
   * ClickHouse step adds (NO-HOLDS, ARCHITECTURE.md section 7). Kept per tenant, since only the
   * driver knows a tenant's target; each list refreshes on the helper's own interval.
   */
  columns({ tenantId }: { tenantId: string }): ClickHouseColumns {
    const known = this.columnLists.get(tenantId);
    if (known !== undefined) return known;
    const columns = ClickHouseColumns.over({
      read: async () =>
        (
          await this.query<{ table: string; name: string }>({
            tenantId,
            sql: CLICKHOUSE_COLUMNS_QUERY,
            table: "system.columns",
            // The schema's column list describes the server, which no tenant owns.
            SKIP_TENANT_CHECK: true,
          })
        ).rows,
    });
    this.columnLists.set(tenantId, columns);
    return columns;
  }

  /**
   * Runs one statement under every policy this client was given; a statement carrying an
   * `{{idBound}}` marker runs once per window its id index read takes, each under every policy.
   */
  async query<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
    const bound = hasIdBound(request)
      ? idBoundOf({
          sql: request.sql,
          params: request.params ?? {},
          registry: this.idIndexRegistry,
          openEnded: request.idBound?.openEnded,
        })
      : null;
    if (bound !== null) return this.boundedQuery<Row>({ request, bound });
    return this.statement<Row>(request);
  }

  /** A statement bounded by its id index, each attempt run as its own statement. */
  private async boundedQuery<Row>({
    request,
    bound,
  }: {
    request: QueryRequest;
    bound: IdBound;
  }): Promise<QueryResult<Row>> {
    const { tenantId } = request;
    const rows = await readIdBound<Row>({
      bound,
      tenantId,
      registry: this.idIndexRegistry,
      targetOf: () => this.targetOf({ tenantId }),
      indexBounds: (lookup) =>
        this.indexBounds({ tenantId, tenantIds: request.tenantIds, ...lookup }),
      options: request.idBound,
      run: async ({ sql, params }) => (await this.statement<Row>({ ...request, sql, params })).rows,
    });
    return { rows };
  }

  /**
   * Runs one statement under every policy this client was given, top to
   * bottom per the class order. Each step is a plain call rather than a
   * wrap, so an absent policy is a skipped line, not a hole in a chain.
   */
  private async statement<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
    this.tenantGuard.assert(request);
    refuseUnexpandedIdBound({ request });

    const runOnce = () => this.driver.execute<Row>(request);
    const withRetries = () =>
      this.retries === undefined
        ? runOnce()
        : this.retries.run(runOnce, { signal: request.signal, request });

    const withReport = () =>
      this.reported({
        operation: "query",
        params: {
          query: request.sql,
          query_params: request.params,
          table: request.table,
          SKIP_COLD_SCAN_CHECK: request.SKIP_COLD_SCAN_CHECK,
        },
        task: withRetries,
      });

    // The slot wraps the retries, so it is held for the whole statement.
    const withSlot = () =>
      this.limiter === undefined
        ? withReport()
        : this.limiter.run({
            operation: "query",
            task: withReport,
            signal: request.signal,
          });

    try {
      return await (this.tracer === undefined
        ? withSlot()
        : this.tracer.trace({ request, task: withSlot }));
    } catch (error) {
      if (this.overloaded !== undefined && isServerOverload(error)) {
        throw this.overloaded.create({ cause: error });
      }
      if (this.unavailable === undefined || !isConnectionFailure(error)) throw error;
      throw this.unavailable.create({ cause: error });
    }
  }

  /**
   * Streams one read batch by batch (replay's event reads). The tenant guard applies; the slot and
   * retries do not, since the reader sets how long it runs and a retried stream would repeat rows.
   * A driver that cannot stream answers the whole result, under every policy, as one batch.
   */
  async *stream<Row>(request: QueryRequest): AsyncGenerator<Row[]> {
    this.tenantGuard.assert(request);
    // A bounded read expands its marker per window, so it is answered whole, as one batch.
    if (this.driver.stream === undefined || hasIdBound(request)) {
      yield (await this.query<Row>(request)).rows;
      return;
    }
    yield* this.driver.stream<Row>(request);
  }

  /**
   * Run a statement that answers no rows, under every policy this client was
   * given. Same order, same reasons as {@link query}.
   */
  async command(request: QueryRequest): Promise<void> {
    this.tenantGuard.assert(request);
    refuseUnexpandedIdBound({ request });

    const runOnce = () => this.driver.command(request);
    const withRetries = () =>
      this.retries === undefined
        ? runOnce()
        : this.retries.run(runOnce, { signal: request.signal, request });

    if (this.limiter === undefined) return withRetries();
    await this.limiter.run({
      operation: "command",
      task: withRetries,
      signal: request.signal,
    });
  }

  /**
   * Writes one batch under every policy, in {@link query}'s order. Retried in place only when
   * the connection was refused before anything was sent; other failures go to the caller.
   * Spec: specs/background/worker-graceful-shutdown.feature
   */
  async insert(request: InsertRequest): Promise<void> {
    this.tenantGuard.assertInsert(request);
    if (request.rows.length === 0) return;

    // An async insert that would wait for a slot joins others of its route and table (ADR-187).
    const coalesced = this.coalescer?.submit(request, coalesceKeyOf(request));
    if (coalesced !== undefined && coalesced !== null) return coalesced;
    return this.insertAlone(request);
  }

  /** One insert in a statement of its own, under its own slot. */
  private async insertAlone(request: InsertRequest): Promise<void> {
    if (this.limiter === undefined) return this.sendInsert(request);
    await this.limiter.run({
      operation: "insert",
      task: () => this.sendInsert(request),
      signal: request.signal,
    });
  }

  /** One insert statement under the slot already held: retried only when refused, and reported. */
  private sendInsert(request: InsertRequest): Promise<void> {
    const runOnce = () => this.driver.insert(request);
    const refusedOnly = async (): Promise<void> => {
      try {
        await runOnce();
      } catch (error) {
        if (wasRefusedBeforeSending(error)) throw error;
        throw new InsertNotRetriedInPlace(error);
      }
    };
    const withRetries = async (): Promise<void> => {
      if (this.retries === undefined) return runOnce();
      try {
        await this.retries.run(refusedOnly, {
          signal: request.signal,
          request: {
            tenantId: request.tenantId,
            sql: `INSERT INTO ${request.table}`,
            table: request.table,
            kind: "write",
          },
        });
      } catch (error) {
        throw error instanceof InsertNotRetriedInPlace ? error.failure : error;
      }
    };
    return this.reported({
      operation: "insert",
      params: { table: request.table },
      task: withRetries,
    });
  }

  /** One statement's outcome, reported the way the vendor client policy reports it. */
  private async reported<T>({
    operation,
    params,
    task,
  }: {
    operation: StatementOperation;
    params: Record<string, unknown>;
    task: () => Promise<T>;
  }): Promise<T> {
    const reporter = this.reporter;
    if (reporter === undefined) return task();

    const queryType = operation === "insert" ? "INSERT" : extractQueryType(params);
    const table = extractTableName(params);
    const start = now();
    try {
      const result = await task();
      const durationMs = now() - start;
      reporter.success({ operation, durationMs, params });
      reporter.outcome({ queryType, table, durationMs, outcome: "success" });
      return result;
    } catch (error) {
      const durationMs = now() - start;
      reporter.failure({ operation, error, durationMs, params });
      reporter.outcome({ queryType, table, durationMs, outcome: "error" });
      throw error;
    }
  }
}

/**
 * One statement carrying every request's rows. They share a coalescing key, so the route, the
 * tenant set and the settings are the first's; each request passed the tenant guard on its own.
 */
function coalescedRequest(requests: readonly InsertRequest[]): InsertRequest {
  const [first, ...rest] = requests;
  if (first === undefined) throw new Error("A coalesced insert carries at least one request.");
  if (rest.length === 0) return first;
  return { ...first, rows: requests.flatMap((request) => request.rows) };
}

/** The last check before a statement leaves: an unexpanded marker never reaches the server. */
function refuseUnexpandedIdBound({ request }: { request: QueryRequest }): void {
  if (hasIdBound(request)) throw new StatementScopeError({ kind: "unexpanded-id-bound" });
}
