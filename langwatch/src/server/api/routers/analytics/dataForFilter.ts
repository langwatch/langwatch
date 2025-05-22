import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { esClient, TRACE_INDEX } from "../../../elasticsearch";
import { filterFieldsEnum } from "../../../filters/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { availableFilters } from "../../../filters/registry";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { generateTracesPivotQueryConditions } from "./common";
import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/typesWithBodyKey";

export const dataForFilter = protectedProcedure
  .input(
    sharedFiltersInputSchema.extend({
      field: filterFieldsEnum,
      key: z.string().optional(),
      subkey: z.string().optional(),
      query: z.string().optional(),
    })
  )
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    const { field, key, subkey } = input;

    if (availableFilters[field].requiresKey && !key) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a key to be defined`,
      });
    }

    if (availableFilters[field].requiresSubkey && !subkey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a subkey to be defined`,
      });
    }

    const { pivotIndexConditions } = generateTracesPivotQueryConditions({
      ...input,
      filters: {
        ...(input.filters["topics.topics"]
          ? { "topics.topics": input.filters["topics.topics"] }
          : {}),
      },
    });

    const client = await esClient({ projectId: input.projectId });
    const response = await client.search({
      index: TRACE_INDEX.alias,
      body: {
        size: 0,
        query: pivotIndexConditions,
        aggs: availableFilters[field].listMatch.aggregation(
          input.query,
          key,
          subkey
        ) as Record<string, AggregationsAggregationContainer>,
      },
    });

    const results = availableFilters[field].listMatch.extract(
      (response.aggregations ?? {}) as any
    );

    return { options: results };
  });
