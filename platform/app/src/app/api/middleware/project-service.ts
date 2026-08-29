import type { MiddlewareHandler } from "hono";
import type { App } from "~/server/app-layer/app";
import { appFromContext } from "~/app/api/middleware/app-context";

/**
 * The Project feature's application, not its service: `App.projects` holds
 * `ProjectApp`, and a variable still typed `ProjectService` would tell a
 * future consumer it can call reads the application does not answer.
 */
export type ProjectServiceMiddlewareVariables = {
  projectService: App["projects"];
};

export const projectServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("projectService", appFromContext(c).projects);
  await next();
};
