/**
 * Runs each LangWatchQL statement on the ClickHouse holding its projects' rows: the shared one,
 * or an organization's own. Always as the LangWatchQL identity: a private route's credentials
 * are dropped, since that route's user may create and drop anything. Spec: specs/lwql/api.feature.
 */
import { LangWatchQLUnavailableError } from "@langwatch/analytics-contract";
import {
  PrivateRouteUnavailableError,
  type TenantRoute,
  TenantScopeError,
} from "@langwatch/clickhouse-client";

import { RESERVED_DATABASES } from "../../rules/langwatch-ql-policy.rules.ts";
import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
  type LangWatchQLRoute,
  type LangWatchQLTenantRouting,
} from "../langwatch-ql-executor.repository.ts";
import type { LangWatchQLTarget } from "./clickhouse.langwatch-ql-executor.repository.ts";

/** Builds the executor for one ClickHouse, dialled as the given connection. */
export type LangWatchQLExecutorFactory = (input: {
  connection: LangWatchQLConnection;
  target: LangWatchQLTarget;
}) => LangWatchQLExecutorRepository;

const PLAIN_DATABASE_NAME = /^[a-z_][a-z0-9_]*$/;

/** Private executors kept open at once; the least recently used is closed past this. */
const DEFAULT_MAX_PRIVATE_EXECUTORS = 100;

const NOT_AVAILABLE = "LangWatchQL is not available for this organization's ClickHouse.";

/**
 * A set spanning organizations, or a private organization whose route is missing or broken.
 * The handled private_dataplane_unavailable is not one: it names the variable (never its
 * value), is safe to show, and passes through with its own code.
 */
function isRouteRefusal(error: unknown): error is Error {
  return error instanceof TenantScopeError || error instanceof PrivateRouteUnavailableError;
}

/** The refusal, with a fixed reason for operators; no part of the route URL goes in. */
function refused(reason: string): LangWatchQLUnavailableError {
  return new LangWatchQLUnavailableError({ message: NOT_AVAILABLE, reasons: [new Error(reason)] });
}

/**
 * The route's server as the LangWatchQL identity: its origin and database, never the route's
 * user or password. A URL that is not http(s), or names no database, a reserved one or a
 * non-lower-case-identifier one, is refused without its text, which may carry those credentials.
 */
function privateConnectionOf({
  shared,
  url,
}: {
  shared: LangWatchQLConnection;
  url: string;
}): LangWatchQLConnection {
  let parsed: URL;
  let database: string;
  try {
    parsed = new URL(url);
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    // Never the caught error: a URL parse failure carries the whole URL, password included.
    throw refused("unparsable route URL");
  }
  // Any other scheme parses to the origin "null", which no driver can dial.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw refused("bad scheme");
  // Failing closed: a route naming no database must not adopt the shared deployment's.
  if (database === "") throw refused("no database");
  // Written unquoted into generated SQL: only a lower-case identifier, never a reserved one.
  if (!PLAIN_DATABASE_NAME.test(database)) throw refused("bad name shape");
  if (RESERVED_DATABASES.includes(database)) throw refused("reserved database");
  return { ...shared, url: parsed.origin, database };
}

/** Routes each statement by its projects, with one executor per private organization. */
export class RoutedLangWatchQLExecutorRepository extends LangWatchQLExecutorRepository {
  private readonly privateExecutors = new Map<string, LangWatchQLExecutorRepository>();

  static create({
    connection,
    route,
    createExecutor,
    maxPrivateExecutors = DEFAULT_MAX_PRIVATE_EXECUTORS,
  }: {
    connection: LangWatchQLConnection;
    route: LangWatchQLTenantRouting;
    createExecutor: LangWatchQLExecutorFactory;
    maxPrivateExecutors?: number;
  }): RoutedLangWatchQLExecutorRepository {
    return new RoutedLangWatchQLExecutorRepository({
      connection,
      route,
      createExecutor,
      maxPrivateExecutors,
      sharedExecutor: createExecutor({ connection, target: "shared" }),
    });
  }

  private readonly connection: LangWatchQLConnection;
  private readonly route: LangWatchQLTenantRouting;
  private readonly createExecutor: LangWatchQLExecutorFactory;
  private readonly sharedExecutor: LangWatchQLExecutorRepository;
  private readonly maxPrivateExecutors: number;

  private constructor({
    connection,
    route,
    createExecutor,
    sharedExecutor,
    maxPrivateExecutors,
  }: {
    connection: LangWatchQLConnection;
    route: LangWatchQLTenantRouting;
    createExecutor: LangWatchQLExecutorFactory;
    sharedExecutor: LangWatchQLExecutorRepository;
    maxPrivateExecutors: number;
  }) {
    super();
    this.connection = connection;
    this.route = route;
    this.createExecutor = createExecutor;
    this.sharedExecutor = sharedExecutor;
    if (!Number.isInteger(maxPrivateExecutors) || maxPrivateExecutors < 1) {
      throw new RangeError("maxPrivateExecutors must be a positive integer");
    }
    this.maxPrivateExecutors = maxPrivateExecutors;
  }

  /** A run without its projects has no route: ask `resolveRoute`, then run on its executor. */
  async execute(_request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    throw new Error("Resolve the route with resolveRoute before executing.");
  }

  /** Asks the route once; the executor returned never asks again, and names its own database. */
  override async resolveRoute({
    tenantIds,
  }: {
    tenantIds: readonly string[];
  }): Promise<LangWatchQLRoute> {
    // An empty set carries the empty capability, which reads zero rows on any server.
    if (tenantIds.length === 0) return { executor: this.sharedExecutor };
    const route = await this.routeOrRefuse(tenantIds);
    if (route.kind === "shared") return { executor: this.sharedExecutor };

    const connection = privateConnectionOf({ shared: this.connection, url: route.url });
    const cached = this.privateExecutors.get(route.organizationId);
    if (cached !== undefined) {
      // Re-inserted so the map's first key stays the least recently used.
      this.privateExecutors.delete(route.organizationId);
      this.privateExecutors.set(route.organizationId, cached);
      return { executor: cached, database: connection.database };
    }
    const executor = this.createExecutor({ connection, target: "private" });
    this.evictOldestPastBound();
    this.privateExecutors.set(route.organizationId, executor);
    return { executor, database: connection.database };
  }

  private evictOldestPastBound(): void {
    if (this.privateExecutors.size < this.maxPrivateExecutors) return;
    const oldest = this.privateExecutors.entries().next();
    if (oldest.done) return;
    const [organizationId, evicted] = oldest.value;
    this.privateExecutors.delete(organizationId);
    // A close failure of an executor nobody now holds has no caller to tell.
    void evicted.close().catch(() => undefined);
  }

  override async close(): Promise<void> {
    const executors = [this.sharedExecutor, ...this.privateExecutors.values()];
    this.privateExecutors.clear();
    const results = await Promise.allSettled(executors.map((executor) => executor.close()));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }

  private async routeOrRefuse(tenantIds: readonly string[]): Promise<TenantRoute> {
    try {
      return await this.route({ tenantIds });
    } catch (error) {
      if (!isRouteRefusal(error)) throw error;
      throw new LangWatchQLUnavailableError({ message: NOT_AVAILABLE, reasons: [error] });
    }
  }
}
