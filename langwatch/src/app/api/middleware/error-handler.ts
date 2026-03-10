import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { DomainError } from "~/server/app-layer/domain-error";
import { prisma } from "~/server/db";
import { ERR_RESOURCE_LIMIT } from "~/server/license-enforcement/constants";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { buildResourceLimitMessage } from "~/server/license-enforcement/limit-message";
import { NotFoundError as PromptNotFoundError } from "~/server/prompt-config/errors";

import { HttpError, NotFoundError } from "../shared/errors";
import { errorSchema } from "../shared/schemas";

/**
 * Error handling middleware that catches errors and formats responses.
 * Should be used with the `onError` callback of the Hono app.
 * @see https://hono.dev/docs/api/hono#error-handling
 *
 * @example
 * ```ts
 * app.onError(handleError);
 * ```
 */
export const handleError = async (
  error: Error & {
    status?: ContentfulStatusCode;
    code?: string;
    name?: string;
  },
  c: Context,
) => {
  // Determine status code and response
  // Note: Logging is handled by the logger middleware, not here, to avoid double logging
  const { statusCode, response } = await determineErrorResponse(error, c);

  return c.json(response, statusCode);
};

async function determineErrorResponse(
  error: Error & {
    status?: ContentfulStatusCode;
    code?: string;
    name?: string;
  },
  c: Context,
): Promise<{ statusCode: ContentfulStatusCode; response: object }> {
  // DomainErrors are handled first — normalize to client-safe shape
  if (DomainError.is(error)) {
    return {
      statusCode: error.httpStatus as ContentfulStatusCode,
      response: errorSchema.parse({
        error: error.kind,
        message: error.message,
      }),
    };
  }

  // LimitExceededError maps to 403 with structured resource limit response
  if (error instanceof LimitExceededError) {
    const organizationId = await resolveOrganizationIdFromContext(c);
    const message = organizationId
      ? await buildResourceLimitMessage({
          organizationId,
          limitType: error.limitType,
          max: error.max,
        })
      : error.message;

    return {
      statusCode: 403,
      response: {
        error: ERR_RESOURCE_LIMIT,
        message,
        limitType: error.limitType,
        current: error.current,
        max: error.max,
      },
    };
  }

  // Check if it's a "not found" error
  const isNotFoundError =
    error.message?.includes("not found") ||
    // Prisma error code for "not found"
    error.code === "P2025" ||
    error instanceof NotFoundError ||
    error.name === "NotFoundError";

  if (isNotFoundError) {
    const notFoundError = new NotFoundError(error.message);
    return {
      statusCode: notFoundError.status,
      response: errorSchema.parse(notFoundError),
    };
  }

  // Handle HttpError instances (can be parsed directly)
  if (error instanceof HttpError) {
    return {
      statusCode: error.status,
      response: errorSchema.parse(error),
    };
  }

  if (error.status) {
    return {
      statusCode: error.status,
      response: errorSchema.parse({
        error: error.message || "An error occurred",
        message: error.message,
      }),
    };
  }

  // Otherwise treat as server error
  return {
    statusCode: 500,
    response: errorSchema.parse({
      error: "Internal server error",
      message:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    }),
  };
}

/**
 * Resolves organizationId from the Hono context.
 *
 * Tries the organization middleware cache first, then falls back to
 * resolving via the project's teamId. Returns null if neither is available.
 */
async function resolveOrganizationIdFromContext(
  c: Context,
): Promise<string | null> {
  // Try cached organization from organizationMiddleware
  const cachedOrg = c.get("organization") as { id: string } | undefined;
  if (cachedOrg?.id) {
    return cachedOrg.id;
  }

  // Fall back to resolving via project.teamId
  const project = c.get("project") as { teamId: string } | undefined;
  if (!project?.teamId) {
    return null;
  }

  const team = await prisma.team.findUnique({
    where: { id: project.teamId },
    select: { organizationId: true },
  });

  return team?.organizationId ?? null;
}
