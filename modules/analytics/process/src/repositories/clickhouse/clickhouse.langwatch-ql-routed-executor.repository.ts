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

const PLAIN_DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const NOT_AVAILABLE = "LangWatchQL is not available for this organization's ClickHouse.";

/**
 * A set spanning organizations, or a private organization whose route is missing or broken.
 * The handled private_dataplane_unavailable is not one: it names the variable (never its
 * value), is safe to show, and passes through with its own code.
 */
function isRouteRefusal(error: unknown): error is Error {
  return error instanceof TenantScopeError || error instanceof PrivateRouteUnavailableError;
}

/**
 * The route's server as the LangWatchQL identity: its origin and database, never the route's
 * own user or password. A URL without an http or https origin, or naming a database that is
 * not a plain identifier, is refused without its text, which may carry those credentials.
 */
function privateConnectionOf({
  shared,
  url,
}: {
  shared: LangWatchQLConnection;
  url: string;
}): LangWatchQLConnection {
  let origin: string;
  let database: string;
  try {
    const parsed = new URL(url);
    // Any other scheme parses to the origin "null", which no driver can dial.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme");
    origin = parsed.origin;
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    // The name is written unquoted into generated SQL, so only a plain identifier may pass.
    if (database !== "" && !PLAIN_DATABASE_NAME.test(database)) throw new Error("database");
  } catch {
    throw new LangWatchQLUnavailableError({ message: NOT_AVAILABLE });
  }
  return { ...shared, url: origin, database: database === "" ? shared.database : database };
}

/** Routes each statement by its projects, with one executor per private organization. */
export class RoutedLangWatchQLExecutorRepository extends LangWatchQLExecutorRepository {
  private readonly privateExecutors = new Map<string, LangWatchQLExecutorRepository>();

  static create({
    connection,
    route,
    createExecutor,
  }: {
    connection: LangWatchQLConnection;
    route: LangWatchQLTenantRouting;
    createExecutor: LangWatchQLExecutorFactory;
  }): RoutedLangWatchQLExecutorRepository {
    return new RoutedLangWatchQLExecutorRepository({
      connection,
      route,
      createExecutor,
      sharedExecutor: createExecutor({ connection, target: "shared" }),
    });
  }

  private readonly connection: LangWatchQLConnection;
  private readonly route: LangWatchQLTenantRouting;
  private readonly createExecutor: LangWatchQLExecutorFactory;
  private readonly sharedExecutor: LangWatchQLExecutorRepository;

  private constructor({
    connection,
    route,
    createExecutor,
    sharedExecutor,
  }: {
    connection: LangWatchQLConnection;
    route: LangWatchQLTenantRouting;
    createExecutor: LangWatchQLExecutorFactory;
    sharedExecutor: LangWatchQLExecutorRepository;
  }) {
    super();
    this.connection = connection;
    this.route = route;
    this.createExecutor = createExecutor;
    this.sharedExecutor = sharedExecutor;
  }

  async execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const { executor } = await this.resolveRoute({ tenantIds: request.tenantIds });
    return executor.execute(request);
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
    if (cached !== undefined) return { executor: cached, database: connection.database };
    const executor = this.createExecutor({ connection, target: "private" });
    this.privateExecutors.set(route.organizationId, executor);
    return { executor, database: connection.database };
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
