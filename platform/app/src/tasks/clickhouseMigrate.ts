import { createLogger } from "@langwatch/observability";
import { runMigrations } from "../server/clickhouse/goose";
import { PRIVATE_CH_ENV_PREFIX, parseRouteKey } from "../server/clickhouse/privateRouteKey";
import { reconcileTTL } from "../server/clickhouse/ttlReconciler";

const logger = createLogger("langwatch:task:clickhouseMigrate");

export type ClickHouseMigrationEndpoint = {
  organizationId?: string;
  url: string;
};

export type ClickHouseMigrationTaskConfig = {
  buildTime: boolean;
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

/** Runs schema work once per physical endpoint without an App runtime dependency. */
export class ClickHouseMigrationTask {
  private constructor(
    private readonly config: ClickHouseMigrationTaskConfig,
    private readonly executor: GooseClickHouseMigrationExecutor,
  ) {}

  static create({
    config,
    executor = new GooseClickHouseMigrationExecutor(),
  }: {
    config: ClickHouseMigrationTaskConfig;
    executor?: GooseClickHouseMigrationExecutor;
  }): ClickHouseMigrationTask {
    return new ClickHouseMigrationTask(config, executor);
  }

  async execute(): Promise<void> {
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

/** Parses task-owned endpoint input at the executable boundary. */
export function resolveClickHouseMigrationTaskConfig(
  source: Record<string, string | undefined>,
): ClickHouseMigrationTaskConfig {
  const privateEndpoints: ClickHouseMigrationEndpoint[] = [];
  const configuredOrganizations = new Set<string>();
  for (const [key, url] of Object.entries(source)) {
    if (!key.startsWith(PRIVATE_CH_ENV_PREFIX) || url === undefined || url.trim() === "") continue;
    const route = parseRouteKey({ key, prefix: PRIVATE_CH_ENV_PREFIX });
    if (route === null) continue;
    if (configuredOrganizations.has(route.orgId)) {
      throw new Error(`Duplicate private ClickHouse config for ${route.orgId}.`);
    }
    configuredOrganizations.add(route.orgId);
    privateEndpoints.push({ organizationId: route.orgId, url });
  }
  return {
    buildTime: source.BUILD_TIME !== undefined,
    ...(source.CLICKHOUSE_URL === undefined ? {} : { sharedUrl: source.CLICKHOUSE_URL }),
    privateEndpoints,
  };
}

export default async function execute(): Promise<void> {
  await ClickHouseMigrationTask.create({
    config: resolveClickHouseMigrationTaskConfig(process.env),
  }).execute();
}
