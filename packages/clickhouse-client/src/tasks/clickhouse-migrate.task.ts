import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { parseRoutingTable } from "../tenancy";
import { runMigrations } from "./goose.migration-runner";
import { reconcileTTL } from "./ttl.reconciler";

const logger = createLogger("langwatch:task:clickhouse-migrate");

export type ClickHouseMigrationEndpoint = {
  organizationId?: string;
  url: string;
};

export type ClickHouseMigrationTaskConfig = {
  buildTime: boolean;
  /**
   * The operator's own opt-out, `SKIP_CLICKHOUSE_MIGRATE=true`.
   *
   * Exactly `"true"`, because a half-recognised value silently skipping the
   * schema work is the expensive direction to be wrong in: the process then
   * serves against whatever schema happened to be there.
   */
  skipped: boolean;
  sharedUrl?: string;
  privateEndpoints: readonly ClickHouseMigrationEndpoint[];
};

/** Explicit task-local adapter over goose and TTL reconciliation. */
export class GooseClickHouseMigrationExecutor {
  async migrate(url: string): Promise<void> {
    await runMigrations({ connectionUrl: url, verbose: true });
    await reconcileTTL({ connectionUrl: url, verbose: true });
  }
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * clickhouse-migrate`. Runs schema work once per physical endpoint without an
 * App runtime dependency.
 *
 * `source` is resolved to a {@link ClickHouseMigrationTaskConfig} at
 * `create()` — the catalogue's own construction time — rather than read from
 * `process.env` inside `run()`, so the task's environment dependency is
 * visible at the one call site that builds it.
 */
export class ClickHouseMigrateTask extends Task {
  readonly name = "clickhouse-migrate";
  readonly description = "Applies ClickHouse schema migrations and reconciles table TTLs.";

  private constructor(
    private readonly config: ClickHouseMigrationTaskConfig,
    private readonly executor: GooseClickHouseMigrationExecutor,
  ) {
    super();
  }

  static create({
    source,
    executor = new GooseClickHouseMigrationExecutor(),
  }: {
    source: Record<string, string | undefined>;
    executor?: GooseClickHouseMigrationExecutor;
  }): ClickHouseMigrateTask {
    return new ClickHouseMigrateTask(resolveClickHouseMigrationTaskConfig(source), executor);
  }

  /** Test seam: construct directly from an already-resolved config. */
  static createFromConfig({
    config,
    executor = new GooseClickHouseMigrationExecutor(),
  }: {
    config: ClickHouseMigrationTaskConfig;
    executor?: GooseClickHouseMigrationExecutor;
  }): ClickHouseMigrateTask {
    return new ClickHouseMigrateTask(config, executor);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await this.execute();
  }

  async execute(): Promise<void> {
    if (this.config.skipped) {
      logger.info("Skipping ClickHouse migrations");
      return;
    }
    if (this.config.buildTime) return;

    const migratedUrls = new Set<string>();
    if (this.config.sharedUrl !== undefined) {
      await this.migrateEndpoint({ url: this.config.sharedUrl }, migratedUrls);
    }
    for (const endpoint of this.config.privateEndpoints) {
      await this.migrateEndpoint(endpoint, migratedUrls);
    }
  }

  private async migrateEndpoint(
    endpoint: ClickHouseMigrationEndpoint,
    migratedUrls: Set<string>,
  ): Promise<void> {
    if (migratedUrls.has(endpoint.url)) {
      if (endpoint.organizationId !== undefined) {
        logger.info(
          { orgId: endpoint.organizationId },
          "Skipping private ClickHouse migration for an aliased endpoint",
        );
      }
      return;
    }
    migratedUrls.add(endpoint.url);

    if (endpoint.organizationId !== undefined) {
      logger.info(
        { orgId: endpoint.organizationId },
        "Running migrations on private ClickHouse instance",
      );
    }
    try {
      await this.executor.migrate(endpoint.url);
    } catch (error) {
      if (endpoint.organizationId !== undefined) {
        logger.error(
          {
            orgId: endpoint.organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to run migrations on private ClickHouse instance",
        );
      }
      throw error;
    }
  }
}

/**
 * Parses task-owned endpoint input at the executable boundary.
 *
 * The private routes are read through the shared client's own
 * `parseRoutingTable`, so a migration reaches exactly the endpoints this
 * process would route a tenant to. That parser is total for a malformed name
 * — it collects those rather than throwing — and it is the one that refuses a
 * duplicate organisation, which is what this task needs: two URLs for one
 * organisation is not a migration to run twice, it is a configuration nobody
 * can safely guess at.
 */
export function resolveClickHouseMigrationTaskConfig(
  source: Record<string, string | undefined>,
): ClickHouseMigrationTaskConfig {
  const table = parseRoutingTable(source);
  for (const skipped of table.skipped) {
    logger.warn(
      { envVar: skipped.envVar, reason: skipped.reason },
      "Ignoring a malformed ClickHouse route variable",
    );
  }
  for (const guess of table.ambiguous) {
    logger.warn(
      { envVar: guess.envVar, organizationId: guess.organizationId },
      "A ClickHouse route variable was split by guess; rename it if that is not the intent",
    );
  }
  const privateEndpoints: ClickHouseMigrationEndpoint[] = [...table.routes].map(
    ([organizationId, url]) => ({ organizationId, url }),
  );
  return {
    buildTime: source.BUILD_TIME !== undefined,
    skipped: source.SKIP_CLICKHOUSE_MIGRATE === "true",
    ...(source.CLICKHOUSE_URL === undefined ? {} : { sharedUrl: source.CLICKHOUSE_URL }),
    privateEndpoints,
  };
}
