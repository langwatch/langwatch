import type { MiddlewareHandler } from "hono";
import type { DatasetService } from "@langwatch/dataset-contract";
import { appFromContext } from "./app-context";

export type DatasetServiceMiddlewareVariables = {
  datasetService: DatasetService;
};

export const datasetServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("datasetService", appFromContext(c).dataset);
  await next();
};
