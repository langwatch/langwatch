import type { MiddlewareHandler } from "hono";
import { GroupRestService } from "~/server/app-layer/groups/group.service";
import { PrismaGroupRepository } from "~/server/app-layer/groups/repositories/group.prisma.repository";
import { prisma } from "~/server/db";
import { RoleService } from "~/server/role";

export type GroupServiceMiddlewareVariables = {
  groupService: GroupRestService;
};

export const groupServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set(
    "groupService",
    new GroupRestService({
      repo: new PrismaGroupRepository(prisma),
      roleService: new RoleService(prisma),
    }),
  );
  await next();
};
