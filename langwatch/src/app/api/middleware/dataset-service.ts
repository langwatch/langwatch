import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { DatasetService } from "~/server/datasets/dataset.service";

export type DatasetServiceMiddlewareVariables = {
  datasetService: DatasetService;
};

export const datasetServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("datasetService", DatasetService.create(prisma));
  await next();
};
