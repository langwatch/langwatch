import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import { getApp } from "~/server/app-layer/app";
import { PlanLimitExceededError } from "~/server/app-layer/usage/errors";
import { prisma } from "~/server/db";

const logger = createLogger("langwatch:api:middleware:trace-limit");

/**
 * Middleware to check trace usage limits before allowing requests
 */
export const blockTraceUsageExceededMiddleware: MiddlewareHandler = async (
  c,
  next,
) => {
  const project = c.get("project");
  const result = await getApp().usage.checkLimit({ teamId: project.teamId });

  if (result.exceeded) {
    try {
      const team = await prisma.team.findUnique({
        where: { id: project.teamId },
        select: { organizationId: true },
      });

      if (team?.organizationId) {
        const activePlan = await getApp().planProvider.getActivePlan({
          organizationId: team.organizationId,
        });

        await getApp().usageLimits.notifyPlanLimitReached({
          organizationId: team.organizationId,
          planName: activePlan.name ?? "free",
        });
      }
    } catch (error) {
      logger.error(
        { error, projectId: project.id },
        "Plan limit notification failed",
      );
    }

    logger.info(
      {
        projectId: project.id,
        currentMonthMessagesCount: result.count,
        activePlanName: result.planName,
        maxMessagesPerMonth: result.maxMessagesPerMonth,
      },
      "Project has reached plan limit",
    );

    throw new PlanLimitExceededError(result.message, {
      currentMonthMessagesCount: result.count,
      maxMessagesPerMonth: result.maxMessagesPerMonth,
      activePlanName: result.planName,
    });
  }

  await next();
};
