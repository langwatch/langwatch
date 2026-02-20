import type { MiddlewareHandler } from "hono";
import { notifyPlanLimitReached } from "../../../../ee/billing";
import { prisma } from "~/server/db";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { TraceUsageService } from "~/server/traces/trace-usage.service";
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
  const service = TraceUsageService.create();

  const result = await service.checkLimit({ teamId: project.teamId });

  if (result.exceeded) {
    try {
      const team = await prisma.team.findUnique({
        where: { id: project.teamId },
        select: { organizationId: true },
      });

      if (team?.organizationId) {
        const activePlan = await SubscriptionHandler.getActivePlan(
          team.organizationId,
        );

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
