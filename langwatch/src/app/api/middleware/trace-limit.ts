import type { MiddlewareHandler } from "hono";
import { TracesService } from "~/server/traces/traces.service";

/**
 * Middleware to check trace usage limits before allowing requests
 */
export const blockTraceUsageExceededMiddleware: MiddlewareHandler = async (c, next) => {
  const project = c.get("project");
  const service = TracesService.create();

  const result = await service.checkLimit({ teamId: project.teamId });

  if (result.exceeded) {
    return c.json({ error: "ERR_PLAN_LIMIT", message: result.message }, 429);
  }

  await next();
};

