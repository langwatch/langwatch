import type { MiddlewareHandler } from "hono";
import { notifyPlanLimitReached } from "../../../../ee/billing";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { LIMIT_TYPE_LABELS } from "~/server/license-enforcement/constants";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import type { LimitType } from "~/server/license-enforcement/types";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:middleware:resource-limit");

/**
 * Creates a Hono middleware that enforces resource limits for create operations.
 *
 * Self-contained: resolves organizationId from project.teamId directly,
 * without depending on organizationMiddleware.
 *
 * @param limitType - The resource type to enforce limits for
 * @returns Hono middleware handler
 */
export function resourceLimitMiddleware(
  limitType: LimitType,
): MiddlewareHandler {
  return async (c, next) => {
    const project = c.get("project");
    const organizationId = await resolveOrganizationId(project.teamId);

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
        const message = await buildResourceLimitMessage({
          organizationId,
          limitType,
          max: error.max,
        });

        // Fire-and-forget notification
        fireNotification(organizationId).catch((notifyError) => {
          logger.error(
            { error: notifyError, organizationId },
            "Plan limit notification failed",
          );
        });

        return c.json(
          {
            error: "ERR_RESOURCE_LIMIT",
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
 * Builds a customer-facing message that varies by planSource and deployment mode.
 *
 * Message patterns:
 * - free + SaaS: "Free plan limit of {max} {label} reached. To increase your limits, upgrade your plan at ..."
 * - subscription + SaaS: "Plan limit of {max} {label} reached. To increase your limits, upgrade your plan at ..."
 * - free + self-hosted: "Free plan limit of {max} {label} reached. To increase your limits, get a license at ..."
 * - license + self-hosted: "License limit of {max} {label} reached. To increase your limits, upgrade your license at ..."
 */
async function buildResourceLimitMessage({
  organizationId,
  limitType,
  max,
}: {
  organizationId: string;
  limitType: LimitType;
  max: number;
}): Promise<string> {
  const label = LIMIT_TYPE_LABELS[limitType];

  let planSource: "free" | "subscription" | "license" = "free";
  try {
    const activePlan = await getApp().planProvider.getActivePlan({
      organizationId,
    });
    planSource = activePlan.planSource;
  } catch (error) {
    logger.error(
      { error, organizationId },
      "Failed to resolve plan for limit message, defaulting to free",
    );
  }

  const prefix = buildMessagePrefix(planSource);
  const action = buildUpgradeAction(planSource);

  return `${prefix} limit of ${max} ${label} reached. To increase your limits, ${action}`;
}

/**
 * Returns the prefix for the limit message based on planSource.
 */
function buildMessagePrefix(
  planSource: "free" | "subscription" | "license",
): string {
  switch (planSource) {
    case "free":
      return "Free plan";
    case "subscription":
      return "Plan";
    case "license":
      return "License";
  }
}

/**
 * Returns the upgrade action based on planSource and deployment mode.
 */
function buildUpgradeAction(
  planSource: "free" | "subscription" | "license",
): string {
  if (env.IS_SAAS) {
    return "upgrade your plan at https://app.langwatch.ai/settings/subscription";
  }

  const baseHost = env.BASE_HOST ?? "https://app.langwatch.ai";

  if (planSource === "free") {
    return `get a license at ${baseHost}/settings/license`;
  }

  return `upgrade your license at ${baseHost}/settings/license`;
}

/**
 * Fires plan limit notification asynchronously.
 * The notifier handles SaaS-only gating and 30-day rate limiting internally.
 */
async function fireNotification(organizationId: string): Promise<void> {
  const activePlan = await getApp().planProvider.getActivePlan({
    organizationId,
  });

  await notifyPlanLimitReached({
    organizationId,
    planName: activePlan.name ?? "free",
  });
}
