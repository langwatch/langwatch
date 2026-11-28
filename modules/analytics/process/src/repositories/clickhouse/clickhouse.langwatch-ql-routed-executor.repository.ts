/**
 * Runs each LangWatchQL statement where its projects' rows are: the shared ClickHouse, or an
 * organization's own as that organization's derived reader; neither the shared login nor the
 * route URL's own ever signs a query. Spec: api.feature.
 */
import { LangWatchQLUnavailableError } from "@langwatch/analytics-contract";
import {
  PrivateRouteUnavailableError,
  type TenantRoute,
  TenantScopeError,
} from "@langwatch/clickhouse-client";

import type {
  LwqlPrivateReader,
  LwqlPrivateReaderOf,
} from "../../rules/lwql-private-reader.rules.ts";
import { readPrivateRoute } from "../../rules/lwql-private-route.rules.ts";
import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
  type LangWatchQLRoute,
  type LangWatchQLRouter,
  type LangWatchQLTenantRouting,
} from "../langwatch-ql-executor.repository.ts";
import type { LangWatchQLTarget } from "./clickhouse.langwatch-ql-executor.repository.ts";

/** Builds the executor for one ClickHouse, dialled as the given connection. */
export type LangWatchQLExecutorFactory = (input: {
  connection: LangWatchQLConnection;
  target: LangWatchQLTarget;
}) => LangWatchQLExecutorRepository;

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
 * The route's server and database from its URL, the login from the organization's derived reader;
 * the URL's own user and password are never read. The tenant setting's name is the shared one.
 * A bad scheme, no database, a reserved or non-identifier one, or no reader is refused unnamed.
 */
function privateConnectionOf({
  shared,
  url,
  reader,
}: {
  shared: LangWatchQLConnection;
  url: string;
  reader: LwqlPrivateReader | null;
}): LangWatchQLConnection {
  const read = readPrivateRoute({ url });
  if ("refusal" in read) throw refused(read.refusal);
  // Failing closed: with no reader to derive, the route's own login must not stand in.
  if (reader === null) throw refused("no private reader");
  return {
    url: read.route.origin,
    username: reader.username,
    password: reader.password,
    database: read.route.database,
    tenantSetting: shared.tenantSetting,
  };
}

/** An organization's executor, and the statements running on it right now. */
interface PrivateExecutor {
  readonly executor: LangWatchQLExecutorRepository;
  running: number;
  retired: boolean;
}

/** A close failure of an executor nobody now holds has no caller to tell. */
function closeQuietly(executor: LangWatchQLExecutorRepository): void {
  void executor.close().catch(() => undefined);
}

/** A private route's runs, each on that organization's executor, held open while it runs. */
class PrivateRouteExecutor extends LangWatchQLExecutorRepository {
  private readonly run: (
    request: LangWatchQLExecutionRequest,
  ) => Promise<LangWatchQLExecutionResult>;

  constructor({
    run,
  }: {
    run: (request: LangWatchQLExecutionRequest) => Promise<LangWatchQLExecutionResult>;
  }) {
    super();
    this.run = run;
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    return this.run(request);
  }
}

/** Routes each statement by its projects, with one executor per private organization. */
export class RoutedLangWatchQLExecutorRepository implements LangWatchQLRouter {
  private readonly privateExecutors = new Map<string, PrivateExecutor>();

  static create({
    connection,
    route,
    createExecutor,
    privateReader = null,
    maxPrivateExecutors = DEFAULT_MAX_PRIVATE_EXECUTORS,
  }: {
    connection: LangWatchQLConnection;
    route: LangWatchQLTenantRouting;
    createExecutor: LangWatchQLExecutorFactory;
    /** An organization's reader; null, or answering null, where it has none: its runs refuse. */
    privateReader?: LwqlPrivateReaderOf | null;
    maxPrivateExecutors?: number;
  }): RoutedLangWatchQLExecutorRepository {
    return new RoutedLangWatchQLExecutorRepository({
      connection,
      route,
      createExecutor,
      privateReader,
      maxPrivateExecutors,
      sharedExecutor: createExecutor({ connection, target: "shared" }),
    });
  }

  private readonly connection: LangWatchQLConnection;
  private readonly route: LangWatchQLTenantRouting;
  private readonly createExecutor: LangWatchQLExecutorFactory;
  private readonly privateReader: LwqlPrivateReaderOf | null;
  private readonly sharedExecutor: LangWatchQLExecutorRepository;
  private readonly maxPrivateExecutors: number;

  private constructor({
    connection,
    route,
    createExecutor,
    privateReader,
    sharedExecutor,
    maxPrivateExecutors,
  }: {
    connection: LangWatchQLConnection;
    route: LangWatchQLTenantRouting;
    createExecutor: LangWatchQLExecutorFactory;
    privateReader: LwqlPrivateReaderOf | null;
    sharedExecutor: LangWatchQLExecutorRepository;
    maxPrivateExecutors: number;
  }) {
    this.connection = connection;
    this.route = route;
    this.createExecutor = createExecutor;
    this.privateReader = privateReader;
    this.sharedExecutor = sharedExecutor;
    if (!Number.isInteger(maxPrivateExecutors) || maxPrivateExecutors < 1) {
      throw new RangeError("maxPrivateExecutors must be a positive integer");
    }
    this.maxPrivateExecutors = maxPrivateExecutors;
  }

  /** Asks the route once; the executor returned never asks again, and names its own database. */
  async resolveRoute({ tenantIds }: { tenantIds: readonly string[] }): Promise<LangWatchQLRoute> {
    // An empty set carries the empty capability, which reads zero rows on any server.
    if (tenantIds.length === 0) return { executor: this.sharedExecutor };
    const route = await this.routeOrRefuse(tenantIds);
    if (route.kind === "shared") return { executor: this.sharedExecutor };

    const { organizationId } = route;
    const connection = privateConnectionOf({
      shared: this.connection,
      url: route.url,
      reader: this.privateReader?.({ organizationId }) ?? null,
    });
    const executor = new PrivateRouteExecutor({
      run: (request) => this.runPrivate({ organizationId, connection, request }),
    });
    return { executor, database: connection.database };
  }

  /** Counts the run on its executor, so an eviction meanwhile closes it only once the run ends. */
  private async runPrivate({
    organizationId,
    connection,
    request,
  }: {
    organizationId: string;
    connection: LangWatchQLConnection;
    request: LangWatchQLExecutionRequest;
  }): Promise<LangWatchQLExecutionResult> {
    const held = this.privateExecutorFor({ organizationId, connection });
    held.running += 1;
    try {
      return await held.executor.execute(request);
    } finally {
      held.running -= 1;
      if (held.retired && held.running === 0) closeQuietly(held.executor);
    }
  }

  private privateExecutorFor({
    organizationId,
    connection,
  }: {
    organizationId: string;
    connection: LangWatchQLConnection;
  }): PrivateExecutor {
    const cached = this.privateExecutors.get(organizationId);
    if (cached !== undefined) {
      // Re-inserted so the map's first key stays the least recently used.
      this.privateExecutors.delete(organizationId);
      this.privateExecutors.set(organizationId, cached);
      return cached;
    }
    const executor = this.createExecutor({ connection, target: "private" });
    this.evictOldestPastBound();
    const held: PrivateExecutor = { executor, running: 0, retired: false };
    this.privateExecutors.set(organizationId, held);
    return held;
  }

  private evictOldestPastBound(): void {
    if (this.privateExecutors.size < this.maxPrivateExecutors) return;
    const oldest = this.privateExecutors.entries().next();
    if (oldest.done) return;
    const [organizationId, evicted] = oldest.value;
    this.privateExecutors.delete(organizationId);
    evicted.retired = true;
    if (evicted.running === 0) closeQuietly(evicted.executor);
  }

  async close(): Promise<void> {
    const held = [...this.privateExecutors.values()].map(({ executor }) => executor);
    const executors = [this.sharedExecutor, ...held];
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
