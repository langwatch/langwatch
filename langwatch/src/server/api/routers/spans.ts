import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { SPAN_INDEX, esClient } from "../../elasticsearch";
import type { ElasticSearchSpan } from "../../tracer/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const spansRouter = createTRPCRouter({
  getAllForTrace: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.SPANS_DEBUG))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const projectTeam = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { team: { select: { members: { where: { userId } } } } },
      });

      if (!projectTeam || projectTeam.team.members.length === 0) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const result = await esClient.search<ElasticSearchSpan>({
        index: SPAN_INDEX,
        body: {
          query: {
            //@ts-ignore
            bool: {
              must: [
                { term: { trace_id: input.traceId } },
                { term: { project_id: input.projectId } },
              ],
            },
          },
        },
      });

      const spans = result.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      return spans;
    }),
});
