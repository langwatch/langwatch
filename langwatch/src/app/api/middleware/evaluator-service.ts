import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";

export type EvaluatorServiceMiddlewareVariables = {
  evaluatorService: EvaluatorService;
};

export const evaluatorServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("evaluatorService", EvaluatorService.create(prisma));
  await next();
};
