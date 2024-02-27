import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { TRACES_PIVOT_INDEX, esClient } from "../../../elasticsearch";
import { filterFieldsEnum } from "../../../filters/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { availableFilters } from "../../../filters/registry";

export const dataForFilter = protectedProcedure
  .input(
    z.object({
      projectId: z.string(),
      field: filterFieldsEnum,
      key: z.string().optional(),
      query: z.string().optional(),
    })
  )
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    const { projectId, field, key } = input;

    if (availableFilters[field].listMatch.requiresKey && !key) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a key to be defined`,
      });
    }

    const response = await esClient.search({
      index: TRACES_PIVOT_INDEX, // Adjust the index based on the field
      body: {
        size: 0,
        query: {
          bool: {
            must: [{ term: { "trace.project_id": projectId } }],
          } as any,
        },
        aggs: availableFilters[field].listMatch.aggregation(input.query, key),
      },
    });

    const results = availableFilters[field].listMatch.extract(
      (response.aggregations ?? {}) as any
    );

    return { options: results };
  });
