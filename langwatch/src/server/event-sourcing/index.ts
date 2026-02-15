/**
 * Event Sourcing Module
 *
 * This module provides event sourcing infrastructure for the LangWatch application.
 * Use the initialization functions during application startup before using pipelines.
 *
 * @example
 * ```typescript
 * // In app startup (start.ts, worker.ts)
 * import { initializeEventSourcing } from '~/server/event-sourcing';
 * import { getClickHouseClient } from '~/server/clickhouse/client';
 * import { connection as redis } from '~/server/redis';
 *
 * initializeEventSourcing({
 *   clickHouseClient: getClickHouseClient(),
 *   redisConnection: redis,
 * });
 *
 * // In tests
 * import { initializeEventSourcingForTesting } from '~/server/event-sourcing';
 *
 * beforeAll(() => {
 *   initializeEventSourcingForTesting();
 * });
 * ```
 */

// Initialization functions (use during app startup)
export {
  initializeEventSourcing,
  initializeEventSourcingForTesting,
  getEventSourcingRuntime,
  getEventSourcingRuntimeOrNull,
  resetEventSourcingRuntime,
} from "./runtime";

// Re-export commonly used types and classes from runtime
export {
  EventSourcingRuntime,
  EventSourcingPipeline,
  getEventSourcing,
  getTraceProcessingPipeline,
  getEvaluationProcessingPipeline,
  createEventSourcingConfig,
} from "./runtime";
export type {
  EventSourcingConfig,
  EventSourcingConfigOptions,
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./runtime";
