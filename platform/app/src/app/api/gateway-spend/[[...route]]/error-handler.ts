import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  canonicalErrorFor,
  requestTraceIds,
} from "../../shared/canonical-error";

const logger = createLogger("langwatch:api:gateway-spend:errors");

/**
 * Every refusal from the spend surface leaves as the canonical envelope
 * (`~/app/api/shared/canonical-error`), so a reconciliation client reads one
 * shape here, on the platform routes, and from the Go data plane.
 */
export const handleGatewaySpendApiError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const { status, body } = canonicalErrorFor(error, requestTraceIds(c));
  logger.error(
    {
      path: c.req.path,
      method: c.req.method,
      status,
      code: body.error.code,
      error: { name: error.name, message: error.message, stack: error.stack },
    },
    `Gateway spend API Error [${status}]: ${error.message || String(error)}`,
  );
  return c.json(body, status);
};
