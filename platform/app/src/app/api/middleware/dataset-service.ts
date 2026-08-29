import type { MiddlewareHandler } from "hono";
import type { App } from "~/server/app-layer/app";
import { appFromContext } from "./app-context";

/**
 * The Dataset feature's application, not its service: `App.dataset` holds
 * `DatasetApp`, and a variable still typed `DatasetService` would tell a
 * future consumer it can call reads the application does not answer.
 */
export type DatasetServiceMiddlewareVariables = {
  datasetService: App["dataset"];
};

export const datasetServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("datasetService", appFromContext(c).dataset);
  await next();
};
