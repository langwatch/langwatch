import {
  AgentNotFoundError,
  InvalidAgentConfigError,
} from "@langwatch/agent-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { handleError } from "../../middleware/error-handler";
import {
  HttpError,
  InternalServerError,
  NotFoundError,
  UnprocessableEntityError,
} from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:agents:errors");

/**
 * Error handler for agent API routes.
 * Converts thrown errors to proper error responses matching the errorSchema.
 */
export const handleAgentError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  let mappedError: Error & { status?: ContentfulStatusCode } = error;
  if (error instanceof AgentNotFoundError) {
    mappedError = new NotFoundError(error.message);
  }
  if (error instanceof InvalidAgentConfigError) {
    mappedError = new UnprocessableEntityError(error.message);
  }
  const path = c.req.path;
  const method = c.req.method;
  const routeParams = c.req.param();
  const status =
    mappedError instanceof HttpError
      ? mappedError.status
      : (mappedError.status ?? 500);

  logger.error(
    {
      path,
      method,
      routeParams,
      status,
      error: {
        name: mappedError.name,
        message: mappedError.message,
        stack: mappedError.stack,
      },
    },
    `Agent API Error [${status}]: ${mappedError.message || String(mappedError)}`,
  );

  if (mappedError instanceof HttpError) {
    return c.json(errorSchema.parse(mappedError), mappedError.status);
  }

  // A handled error already knows its own status, code, meta, reasons and
  // remediation — collapsing it to a 500 here would throw all of that away and
  // report the caller's mistake as our outage. This handler exists to add the
  // family's domain mapping on top of the shared boundary, not to replace it,
  // so anything it has not specifically claimed goes to `handleError`.
  if (HandledError.isHandled(mappedError)) return handleError(mappedError, c);

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
