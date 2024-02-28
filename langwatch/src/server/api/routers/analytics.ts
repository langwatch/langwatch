import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRACE_CHECKS_INDEX, esClient } from "../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import {
  sharedAnalyticsFilterInput,
  generateTraceChecksQueryConditions,
} from "./analytics/common";
import { sessionsVsPreviousPeriod } from "./analytics/sessions";
import { topUsedDocuments } from "./analytics/documents";
import type { TraceCheck } from "../../tracer/types";
import { getTimeseries } from "./analytics/timeseries";
import { dataForFilter } from "./analytics/dataForFilter";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";

export const analyticsRouter = createTRPCRouter({
  getTimeseries,
  dataForFilter,
  sessionsVsPreviousPeriod,
  topUsedDocuments,
  getTraceCheckStatusCounts: protectedProcedure
    .input(sharedAnalyticsFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input }) => {
      const result = await esClient.search<TraceCheck>({
        index: TRACE_CHECKS_INDEX,
        body: {
          size: 0,
          query: {
            bool: {
              filter: generateTraceChecksQueryConditions(input),
            } as QueryDslBoolQuery,
          },
          aggs: {
            status_counts: {
              terms: {
                field: "status",
              },
            },
          },
        },
      });

      const buckets: any[] | undefined = (
        result.aggregations?.status_counts as any
      )?.buckets;

      const statusCounts = buckets?.reduce((acc, bucket) => {
        acc[bucket.key] = bucket.doc_count;
        return acc;
      }, {});

      return {
        failed: (statusCounts?.failed as number) || 0,
        succeeded: (statusCounts?.succeeded as number) || 0,
      };
    }),
});
