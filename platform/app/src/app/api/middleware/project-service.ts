import type { MiddlewareHandler } from "hono";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import { appFromContext } from "./app-context";

export type ProjectServiceMiddlewareVariables = {
  projectService: ProjectService;
};

/**
 * Hands the route the App's `ProjectService`, which carries the LangWatchQL
 * key map, so a project created through the REST API gets its key-map row at
 * once.
 */
export const projectServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("projectService", appFromContext(c).projects);
  await next();
};
