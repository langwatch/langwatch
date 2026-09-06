import type { MiddlewareHandler } from "hono";
import { DatasetService } from "~/server/datasets/dataset.service";
import { prisma } from "~/server/db";

export type DatasetServiceMiddlewareVariables = {
  datasetService: DatasetService;
};

export const datasetServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("datasetService", DatasetService.create(prisma));
  await next();
};
