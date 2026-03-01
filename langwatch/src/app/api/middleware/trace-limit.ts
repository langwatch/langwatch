import type { MiddlewareHandler } from "hono";
import { notifyPlanLimitReached } from "../../../../ee/billing";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";

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

        await notifyPlanLimitReached({
          organizationId: team.organizationId,
          planName: activePlan.name ?? "free",
        });
      }
    } catch (error) {
      logger.error({ error, projectId: project.id }, "Plan limit notification failed");
    }

    return c.json({ error: "ERR_PLAN_LIMIT", message: result.message }, 429);
  }

  await next();
};
