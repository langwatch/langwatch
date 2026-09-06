import type { MiddlewareHandler } from "hono";
import { PrismaTeamRepository } from "~/server/app-layer/teams/repositories/team.prisma.repository";
import { TeamRestService } from "~/server/app-layer/teams/team.service";
import { prisma } from "~/server/db";

export type TeamServiceMiddlewareVariables = {
  teamService: TeamRestService;
};

export const teamServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("teamService", new TeamRestService(new PrismaTeamRepository(prisma)));
  await next();
};
