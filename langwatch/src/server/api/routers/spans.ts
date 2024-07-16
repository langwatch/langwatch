import { PublicShareResourceTypes } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { SPAN_INDEX, esClient } from "../../elasticsearch";
import type { ElasticSearchSpan } from "../../tracer/types";
import { TeamRoleGroup, checkPermissionOrPubliclyShared, checkUserPermissionForProject } from "../permission";

export const spansRouter = createTRPCRouter({
  getAllForTrace: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(
        checkUserPermissionForProject(TeamRoleGroup.SPANS_DEBUG),
        {
          resourceType: PublicShareResourceTypes.TRACE,
          resourceParam: "traceId",
        }
      )
    )
    .query(async ({ input }) => {
      const result = await esClient.search<ElasticSearchSpan>({
        index: SPAN_INDEX,
        size: 50,
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
