import type { MiddlewareHandler } from "hono";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { buildResourceLimitMessage } from "~/server/license-enforcement/limit-message";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import type { LimitType } from "~/server/license-enforcement/types";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:middleware:resource-limit");

/**
 * Creates a Hono middleware that enforces resource limits for create operations.
 *
 * Uses organizationMiddleware's cached organization when available (prompts, evaluators),
 * falling back to a DB query for routes that don't use organizationMiddleware (scenarios).
 *
 * @param limitType - The resource type to enforce limits for
 * @returns Hono middleware handler
 */
export function resourceLimitMiddleware(
  limitType: LimitType,
): MiddlewareHandler {
  return async (c, next) => {
    const project = c.get("project");

    // Prefer organization already resolved by organizationMiddleware to avoid redundant DB query.
    // Falls back to a direct DB lookup for routes that don't use organizationMiddleware (e.g. scenarios).
    const cachedOrganizationId = (
      c.get("organization") as { id: string } | undefined
    )?.id;
    const organizationId =
      cachedOrganizationId ?? (await resolveOrganizationId(project.teamId));

    if (!organizationId) {
      logger.error(
        { projectId: project.id, teamId: project.teamId },
        "Could not resolve organization for resource limit check",
      );
      return c.json(
        {
          error: "Internal Server Error",
          message: "Could not resolve organization",
        },
        500,
      );
    }

    try {
      const enforcement = createLicenseEnforcementService(prisma);
      await enforcement.enforceLimit(organizationId, limitType);
    } catch (error) {
      if (error instanceof LimitExceededError) {
        let message = error.message;
        try {
          message = await buildResourceLimitMessage({
            organizationId,
            limitType,
            max: error.max,
          });
        } catch (messageError) {
          logger.warn(
            { error: messageError, organizationId, limitType },
            "Failed to build resource limit message",
          );
        }

        // Fire-and-forget notification
        fireNotification(organizationId).catch((notifyError) => {
          logger.error(
            { error: notifyError, organizationId },
            "Plan limit notification failed",
          );
        });

        return c.json(
          {
            error: error.kind,
            message,
            limitType: error.limitType,
            current: error.current,
            max: error.max,
          },
          403,
        );
      }
      throw error;
    }

    await next();
  };
}

/**
 * Resolves the organizationId from a teamId.
 * Returns null if the team or organization is not found.
 */
async function resolveOrganizationId(
  teamId: string,
): Promise<string | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });

  return team?.organizationId ?? null;
}

/**
 * Fires plan limit notification asynchronously.
 * The notifier handles SaaS-only gating and 30-day rate limiting internally.
 */
async function fireNotification(organizationId: string): Promise<void> {
  const activePlan = await getApp().planProvider.getActivePlan({
    organizationId,
  });

  await getApp().usageLimits.notifyPlanLimitReached({
    organizationId,
    planName: activePlan.name ?? "free",
  });
}
