import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  canonicalErrorFor,
  requestTraceIds,
} from "../../shared/canonical-error";

const logger = createLogger("langwatch:api:webhooks:errors");

/**
 * Every refusal from the webhook platform leaves as the canonical envelope
 * (`~/app/api/shared/canonical-error`).
 *
 * The surface's two domain failures carry their own codes because they are
 * `HandledError`s (`~/runtime/app/features/webhooks`), so the shared
 * mapper names them without this boundary knowing they exist. That matters
 * beyond tidiness: the codes registry guard only sees codes declared on
 * handled errors, so a code named by hand here would be one nothing checks
 * has customer-facing copy.
 */
export const handleWebhookApiError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const trace = requestTraceIds(c);

  const { status, body } = canonicalErrorFor(error, trace);
  logger.error(
    {
      path: c.req.path,
      method: c.req.method,
      status,
      code: body.error.code,
      error: { name: error.name, message: error.message, stack: error.stack },
    },
    `Webhooks API Error [${status}]: ${error.message || String(error)}`,
  );
  return c.json(body, status);
};
