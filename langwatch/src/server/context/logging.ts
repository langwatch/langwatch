import { getCurrentContext } from "./core";

/**
 * Gets context fields suitable for logging.
 * Always returns an object (never undefined) so it can be spread into log data.
 */
export function getLogContext(): Record<string, string | null> {
  const ctx = getCurrentContext();

  return {
    traceId: ctx?.traceId ?? null,
    spanId: ctx?.spanId ?? null,
    organizationId: ctx?.organizationId ?? null,
    projectId: ctx?.projectId ?? null,
    userId: ctx?.userId ?? null,
  };
}
