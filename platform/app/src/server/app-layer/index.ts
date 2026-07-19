// App (composition root)
export {
  App,
  getApp,
  initializeApp,
  resetApp,
} from "./app";
export type { ClickHouseFactoryOptions } from "./clients/clickhouse.factory";
// Client factories
export { createClickHouseClientFromConfig } from "./clients/clickhouse.factory";
export type { PrismaFactoryOptions } from "./clients/prisma.factory";
export { createPrismaClient } from "./clients/prisma.factory";
export type { RedisFactoryOptions } from "./clients/redis.factory";
export { createRedisConnectionFromConfig } from "./clients/redis.factory";
export type { AppConfig } from "./config";
// Config
export { createAppConfigFromEnv } from "./config";
// Dependencies
export type { AppDependencies } from "./dependencies";
// DSPy Steps
export { DspyStepService } from "./dspy-steps/dspy-step.service";
// Monitors
export { MonitorService } from "./monitors/monitor.service";
export {
  createTestApp,
  initializeDefaultApp,
  initializeWebApp,
  initializeWorkerApp,
} from "./presets";
// Projects
export {
  type ProjectFeatureFlag,
  ProjectService,
} from "./projects/project.service";
// Tracing
export { traced } from "./tracing";
