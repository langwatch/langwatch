import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sharedFiltersInputSchema } from "../../analytics/types";
import { TRACES_PIVOT_INDEX, esClient } from "../../elasticsearch";
import type { TraceCheck } from "../../tracer/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { generateTracesPivotQueryConditions } from "./analytics/common";
import { dataForFilter } from "./analytics/dataForFilter";
import { topUsedDocuments } from "./analytics/documents";
import { sessionsVsPreviousPeriod } from "./analytics/sessions";
import { getTimeseries } from "./analytics/timeseries";

export const analyticsRouter = createTRPCRouter({
  getTimeseries,
  dataForFilter,
  sessionsVsPreviousPeriod,
  topUsedDocuments,
  getTraceCheckStatusCounts: protectedProcedure
    .input(sharedFiltersInputSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input }) => {
      console.log("input", input);
      const result = await esClient.search<TraceCheck>({
        index: TRACES_PIVOT_INDEX,
        body: {
          size: 0,
          query: generateTracesPivotQueryConditions(input).pivotIndexConditions,
          aggs: {
            status_counts: {
              nested: {
                path: "trace_checks",
              },
              aggs: {
                child: {
                  terms: {
                    field: "trace_checks.status",
                  },
                },
              },
            },
          },
        },
      });

      const buckets: any[] | undefined = (
        result.aggregations?.status_counts as any
      )?.child.buckets;

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
