import {
  WebhookEndpointNotFoundError,
  WebhookEndpointValidationError,
} from "@ee/webhooks/webhookEndpoint.service";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  canonicalErrorFor,
  requestTraceIds,
} from "../../shared/canonical-error";
import { apiErrorBody } from "../../shared/schemas";

const logger = createLogger("langwatch:api:webhooks:errors");

/**
 * Every refusal from the webhook platform leaves as the canonical envelope
 * (`~/app/api/shared/canonical-error`).
 *
 * The two domain errors are named here rather than left to the generic
 * status-derived mapping: `not_found` tells a caller nothing about WHICH
 * lookup missed, and an endpoint id is the only one these routes take.
 */
export const handleWebhookApiError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const trace = requestTraceIds(c);

  const domain = ((): { status: ContentfulStatusCode; code: string } | null => {
    if (error instanceof WebhookEndpointNotFoundError) {
      return { status: 404, code: "webhook_endpoint_not_found" };
    }
    if (error instanceof WebhookEndpointValidationError) {
      return { status: 400, code: "webhook_endpoint_invalid" };
    }
    return null;
  })();

  if (domain) {
    return c.json(
      apiErrorBody({
        status: domain.status,
        code: domain.code,
        message:
          error instanceof WebhookEndpointNotFoundError
            ? "Webhook endpoint not found"
            : error.message,
        ...trace,
      }),
      domain.status,
    );
  }

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
