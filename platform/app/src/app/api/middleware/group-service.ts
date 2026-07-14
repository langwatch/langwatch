import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { GroupRestService } from "~/server/app-layer/groups/group.service";
import { PrismaGroupRepository } from "~/server/app-layer/groups/repositories/group.prisma.repository";

export type GroupServiceMiddlewareVariables = {
  groupService: GroupRestService;
};

export const groupServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set(
    "groupService",
    new GroupRestService(new PrismaGroupRepository(prisma)),
  );
  await next();
};
