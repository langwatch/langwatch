import type { MiddlewareHandler } from "hono";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { prisma } from "~/server/db";
import { appFromContext } from "./app-context";

export type ProjectServiceMiddlewareVariables = {
  projectService: ProjectService;
};

/**
 * A Prisma-backed `ProjectService` carrying the App's LangWatchQL key map, so
 * a project created through the REST API gets its key-map row at once rather
 * than reading zero LangWatchQL rows until the next deploy's backfill.
 */
export const projectServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set(
    "projectService",
    new ProjectService(
      new PrismaProjectRepository(prisma),
      appFromContext(c).projects.lwqlKeyMap,
    ),
  );
  await next();
};
