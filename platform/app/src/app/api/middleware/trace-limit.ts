import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import { PlanLimitExceededError } from "~/server/app-layer/usage/errors";

const logger = createLogger("langwatch:api:middleware:trace-limit");

/**
 * Middleware to check trace usage limits before allowing requests
 */
export const blockTraceUsageExceededMiddleware: MiddlewareHandler = async (c, next) => {
  const app = c.app;
  const project = c.get("project");
  const result = await app.usage.checkLimit({ teamId: project.teamId });

  if (result.exceeded) {
    try {
      const team = await app.organizations.getTeamById({
        teamId: project.teamId,
      });
      const activePlan = await app.planProvider.getActivePlan({
        organizationId: team.organizationId,
      });

      await app.usageLimits.notifyPlanLimitReached({
        organizationId: team.organizationId,
        planName: activePlan.name ?? "free",
        usageUnit: result.usageUnit,
        current: result.count,
        max: result.maxMessagesPerMonth,
      });
    } catch (error) {
      logger.error({ error, projectId: project.id }, "Plan limit notification failed");
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
