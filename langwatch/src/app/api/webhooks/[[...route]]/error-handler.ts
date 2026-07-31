import {
  WebhookEndpointNotFoundError,
  WebhookEndpointValidationError,
} from "@ee/webhooks/webhookEndpoint.service";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { handleError } from "../../middleware/error-handler";
import {
  BadRequestError,
  HttpError,
  InternalServerError,
  NotFoundError,
} from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:webhooks:errors");

export const handleWebhookApiError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  // Domain errors map to their HTTP shapes before the shared boundary.
  if (error instanceof WebhookEndpointNotFoundError) {
    const mapped = new NotFoundError("Webhook endpoint not found");
    return c.json(errorSchema.parse(mapped), mapped.status);
  }
  if (error instanceof WebhookEndpointValidationError) {
    const mapped = new BadRequestError(error.message);
    return c.json(errorSchema.parse(mapped), mapped.status);
  }

  const status =
    error instanceof HttpError ? error.status : (error.status ?? 500);
  logger.error(
    {
      path: c.req.path,
      method: c.req.method,
      status,
      error: { name: error.name, message: error.message, stack: error.stack },
    },
    `Webhooks API Error [${status}]: ${error.message || String(error)}`,
  );

  if (error instanceof HttpError) {
    return c.json(errorSchema.parse(error), error.status);
  }
  if (HandledError.isHandled(error)) return handleError(error, c);

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
