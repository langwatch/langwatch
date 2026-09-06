/**
 * Request context propagation module.
 *
 * AsyncLocalStorage-based context propagation for correlating logs and
 * traces across async boundaries.
 *
 * Core context propagation and logger integration live in
 * `@langwatch/observability/context`; this app module only adds framework adapters.
 *
 * @module asyncContext
 */

export {
  createContextFromJobData,
  getCurrentContext,
  getJobContextMetadata,
  getLogContext,
  type JobContextMetadata,
  type JobDataWithContext,
  type RequestContext,
  runWithContext,
  updateCurrentContext,
} from "@langwatch/observability/context";
export { createContextFromHono } from "./adapters/hono";
export { createContextFromTRPC } from "./adapters/trpc";
