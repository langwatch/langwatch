/**
 * Request context propagation module.
 *
 * AsyncLocalStorage-based context propagation for correlating logs and
 * traces across async boundaries.
 *
 * - core.ts: Core types + functions + generic job-payload context helpers
 * - adapters/: Framework-specific context creation (Hono, tRPC)
 * - logging.ts: Logger integration (getLogContext)
 *
 * @module asyncContext
 */

export { createContextFromHono } from "./adapters/hono";
export { createContextFromTRPC } from "./adapters/trpc";
export {
  createContextFromJobData,
  getCurrentContext,
  getJobContextMetadata,
  type JobContextMetadata,
  type JobDataWithContext,
  type RequestContext,
  runWithContext,
  updateCurrentContext,
} from "./core";

export { getLogContext } from "./logging";
