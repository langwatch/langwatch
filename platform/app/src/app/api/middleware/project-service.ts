import type { MiddlewareHandler } from "hono";
import type { ProjectService } from "@langwatch/project-contract";
import { appFromContext } from "~/app/api/middleware/app-context";

export type ProjectServiceMiddlewareVariables = {
  projectService: ProjectService;
};

export const projectServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("projectService", appFromContext(c).projects);
  await next();
};
