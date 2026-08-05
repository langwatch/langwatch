import type { MiddlewareHandler } from "hono";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { prisma } from "~/server/db";

export type ProjectServiceMiddlewareVariables = {
  projectService: ProjectService;
};

export const projectServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set(
    "projectService",
    new ProjectService(new PrismaProjectRepository(prisma)),
  );
  await next();
};
