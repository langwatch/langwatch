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
import { HandledError } from "@langwatch/handled-error";

import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
  type LangWatchQLTenantRouting,
} from "../langwatch-ql-executor.repository.ts";
import type { LangWatchQLTarget } from "./clickhouse.langwatch-ql-executor.repository.ts";

/** Builds the executor for one ClickHouse, dialled as the given connection. */
export type LangWatchQLExecutorFactory = (input: {
  connection: LangWatchQLConnection;
  target: LangWatchQLTarget;
}) => LangWatchQLExecutorRepository;

const NOT_AVAILABLE = "LangWatchQL is not available for this organization's ClickHouse.";

/** A set spanning organizations, or a private organization whose route is missing or broken. */
function isRouteRefusal(error: unknown): error is Error {
  return (
    error instanceof TenantScopeError ||
    error instanceof PrivateRouteUnavailableError ||
    (error instanceof HandledError && error.code === "private_dataplane_unavailable")
  );
}

/**
 * The route's server as the LangWatchQL identity: its origin and database, never the route's
 * own user or password. A URL that does not parse is refused without its text, which may
 * carry those credentials.
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
    origin = parsed.origin;
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
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
    const executor = await this.executorFor(request.tenantIds);
    return executor.execute(request);
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

  private async executorFor(tenantIds: readonly string[]): Promise<LangWatchQLExecutorRepository> {
    // An empty set carries the empty capability, which reads zero rows on any server.
    if (tenantIds.length === 0) return this.sharedExecutor;
    const route = await this.routeOrRefuse(tenantIds);
    if (route.kind === "shared") return this.sharedExecutor;

    const cached = this.privateExecutors.get(route.organizationId);
    if (cached !== undefined) return cached;
    const executor = this.createExecutor({
      connection: privateConnectionOf({ shared: this.connection, url: route.url }),
      target: "private",
    });
    this.privateExecutors.set(route.organizationId, executor);
    return executor;
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
