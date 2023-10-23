import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { Trace } from "../../tracer/types";
import { TRACE_INDEX, esClient } from "../../elasticsearch";
import { TRPCError } from "@trpc/server";

export const tracesRouter = createTRPCRouter({
  getTraces: protectedProcedure
    .input(z.object({ projectId: z.string() }))
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

      const result = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 100,
        sort: {
          "timestamps.started_at": {
            order: "desc",
          },
        },
        body: {
          query: {
            term: { project_id: input.projectId },
          },
        },
      });

      const traces = result.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      return traces;
    }),
});
