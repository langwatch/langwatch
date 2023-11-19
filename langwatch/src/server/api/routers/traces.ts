import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { Trace, TraceCheck, TraceWithChecks } from "../../tracer/types";
import { TRACE_CHECKS_INDEX, TRACE_INDEX, esClient } from "../../elasticsearch";
import { TRPCError } from "@trpc/server";

export const esGetTraceById = async (
  traceId: string
): Promise<Trace | undefined> => {
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      query: {
        term: { id: traceId },
      },
    },
    size: 1,
  });

  return result.hits.hits[0]?._source;
};

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
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

      const tracesResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 1_000,
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

      const traces = tracesResult.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      const checksResult = await esClient.search<TraceCheck>({
        index: TRACE_CHECKS_INDEX,
        body: {
          size: traces.length * 100,
          query: {
            terms: {
              trace_id: traces.map((trace) => trace.id),
            },
          },
        },
      });

      const checksByTraceId: Record<string, TraceCheck[]> =
        checksResult.hits.hits.reduce(
          (acc: Record<string, TraceCheck[]>, hit) => {
            const check = hit._source!;
            if (!acc[check.trace_id]) {
              acc[check.trace_id] = [];
            }
            acc[check.trace_id]?.push(check);
            return acc;
          },
          {}
        );

      const tracesWithChecks: TraceWithChecks[] = traces.map((trace) => ({
        ...trace,
        checks: checksByTraceId[trace.id] ?? [],
      }));

      return tracesWithChecks;
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
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
        body: {
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { id: input.traceId } },
                { term: { project_id: input.projectId } },
              ],
            },
          },
        },
        size: 1,
      });

      const trace = result.hits.hits[0]?._source;

      if (!trace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }

      return trace;
    }),
});
