import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";

export type ProjectServiceMiddlewareVariables = {
  projectService: ProjectService;
};

export const projectServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("projectService", new ProjectService(new PrismaProjectRepository(prisma)));
  await next();
};
