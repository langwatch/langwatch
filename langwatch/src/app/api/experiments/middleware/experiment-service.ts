import { type Context, type Next } from "hono";
import { type ExperimentService, PrismaExperimentService, PrismaExperimentRepository } from "~/server/experiments";

export interface ExperimentServiceMiddlewareVariables {
  experimentService: ExperimentService;
}

export const experimentServiceMiddleware = async (
  c: Context<{ Variables: ExperimentServiceMiddlewareVariables }>,
  next: Next
) => {
  const experimentRepository = new PrismaExperimentRepository();
  const experimentService = new PrismaExperimentService(experimentRepository);
  
  c.set("experimentService", experimentService);
  
  await next();
};
