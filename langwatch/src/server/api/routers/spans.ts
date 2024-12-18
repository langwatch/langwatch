import { PublicShareResourceTypes } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { TRACE_INDEX, esClient } from "../../elasticsearch";
import type { ElasticSearchTrace } from "../../tracer/types";
import {
  TeamRoleGroup,
  checkPermissionOrPubliclyShared,
  checkUserPermissionForProject,
} from "../permission";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";

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
      const result = await esClient.search<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        size: 50,
        body: {
          query: {
            bool: {
              must: [
                { term: { trace_id: input.traceId } },
                { term: { project_id: input.projectId } },
              ] as QueryDslBoolQuery["must"],
            } as QueryDslBoolQuery,
          },
        },
      });

      const spans = result.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x)
        .flatMap((hit) => hit.spans ?? [])
        .sort((a, b) => {
          const startDiff =
            (a.timestamps?.started_at ?? 0) - (b.timestamps?.started_at ?? 0);
          if (startDiff === 0) {
            return (
              (b.timestamps?.finished_at ?? 0) -
              (a.timestamps?.finished_at ?? 0)
            );
          }
          return startDiff;
        });

      return spans;
    }),
});
