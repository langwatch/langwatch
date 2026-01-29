/**
 * Request context propagation module.
 *
 * This module provides AsyncLocalStorage-based context propagation for
 * correlating logs and traces across async boundaries.
 *
 * Architecture:
 * - core.ts: Core types and functions (RequestContext, getCurrentContext, runWithContext)
 * - adapters/: Framework-specific context creation (Hono, tRPC, Next.js, BullMQ)
 * - logging.ts: Logger integration (getLogContext)
 * - contextProvider.ts: Decoupled registry for logger mixin
 *
 * @module asyncContext
 */

// Re-export core types and functions
export {
  type RequestContext,
  type JobContextMetadata,
  getCurrentContext,
  runWithContext,
  updateCurrentContext,
  generateTraceId,
  generateSpanId,
} from "./core";

// Re-export adapters
export { createContextFromHono } from "./adapters/hono";
export { createContextFromTRPC } from "./adapters/trpc";
export {
  createContextFromNextRequest,
  createContextFromNextApiRequest,
} from "./adapters/nextjs";
export {
  createContextFromJobData,
  getJobContextMetadata,
} from "./adapters/bullmq";

// Re-export logging utilities
export { getLogContext } from "./logging";
