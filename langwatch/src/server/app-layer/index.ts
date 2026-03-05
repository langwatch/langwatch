// Domain errors
export {
  DomainError,
  NotFoundError,
  ValidationError
} from "./domain-error";
export type { SerializedDomainError } from "./domain-error";

// Tracing
export { traced } from "./tracing";

// Config
export { createAppConfigFromEnv } from "./config";
export type { AppConfig } from "./config";

// Dependencies
export type { AppDependencies } from "./dependencies";

// Projects
export {
  ProjectService,
  type ProjectFeatureFlag
} from "./projects/project.service";

// Monitors
export { MonitorService } from "./monitors/monitor.service";

// App (composition root)
export {
  App, getApp, initializeApp, resetApp
} from "./app";
export { createTestApp, initializeDefaultApp, initializeWebApp, initializeWorkerApp } from "./presets";

// Client factories
export { createClickHouseClientFromConfig } from "./clients/clickhouse.factory";
export type { ClickHouseFactoryOptions } from "./clients/clickhouse.factory";
export { createPrismaClient } from "./clients/prisma.factory";
export type { PrismaFactoryOptions } from "./clients/prisma.factory";
export { createRedisConnectionFromConfig } from "./clients/redis.factory";
export type { RedisFactoryOptions } from "./clients/redis.factory";

