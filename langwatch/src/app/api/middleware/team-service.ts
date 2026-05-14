import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { TeamRestService } from "~/server/app-layer/teams/team.service";
import { PrismaTeamRepository } from "~/server/app-layer/teams/repositories/team.prisma.repository";

export type TeamServiceMiddlewareVariables = {
  teamService: TeamRestService;
};

export const teamServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("teamService", new TeamRestService(new PrismaTeamRepository(prisma)));
  await next();
};
