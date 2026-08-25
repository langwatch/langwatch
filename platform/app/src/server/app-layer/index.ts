// App (composition root)
export {
  App,
  getApp,
  initializeApp,
  resetApp,
} from "./app";
// Client factories. ClickHouse and Redis are deliberately absent: both are
// reached through the App (a repository, or `getApp().redis`), never by
// constructing a client. See ~/server/clickhouse/managedClient.ts and ADR-093.
export type { PrismaFactoryOptions } from "./clients/prisma.factory";
export { createPrismaClient } from "./clients/prisma.factory";
export type { AppConfig } from "./config";
// Config
export { createAppConfigFromEnv } from "./config";
// Dependencies
export type { AppDependencies } from "./dependencies";
// DSPy Steps
export { DspyStepService } from "./dspy-steps/dspy-step.service";
// Monitors
export { MonitorService } from "@langwatch/monitor-contract";
export {
  createTestApp,
  initializeDefaultApp,
  initializeWebApp,
  initializeWorkerApp,
} from "./presets";
// Projects
export {
  type ProjectFeatureFlag,
} from "@langwatch/project-contract";
export type { ProjectService } from "@langwatch/project-contract";
// Tracing
export { traced } from "./tracing";
