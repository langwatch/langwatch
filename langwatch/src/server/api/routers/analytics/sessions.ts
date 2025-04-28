import { esClient, TRACE_INDEX } from "../../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousDates,
  generateTracesPivotQueryConditions,
} from "./common";
import { sharedFiltersInputSchema } from "../../../analytics/types";

export const sessionsVsPreviousPeriod = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    const client = await esClient({ projectId: input.projectId });
    const { previousPeriodStartDate } = currentVsPreviousDates(input);

    const sessionsQuery = (startDate: number, endDate: number) =>
      client.search({
        index: TRACE_INDEX.alias,
        body: {
          aggs: {
            total_users: {
              cardinality: {
                field: "metadata.user_id",
              },
            },
            total_sessions: {
              cardinality: {
                field: "metadata.thread_id",
              },
            },
            // Direct aggregations for metrics instead of nested user buckets
            thread_sessions: {
              terms: {
                field: "metadata.thread_id",
                size: 10000,
              },
              aggs: {
                interactions: {
                  value_count: {
                    field: "timestamps.started_at",
                  },
                },
                session_duration: {
                  scripted_metric: {
                    init_script:
                      "state.min = Long.MAX_VALUE; state.max = Long.MIN_VALUE;",
                    map_script: `
                      if (doc.containsKey('timestamps.started_at') && !doc['timestamps.started_at'].empty) {
                        long timestamp = doc['timestamps.started_at'].value.toInstant().toEpochMilli();
                        if (timestamp < state.min) state.min = timestamp;
                        if (timestamp > state.max) state.max = timestamp;
                      }
                    `,
                    combine_script:
                      "return ['min': state.min, 'max': state.max];",
                    reduce_script: `
                      long min = Long.MAX_VALUE;
                      long max = Long.MIN_VALUE;
                      for (state in states) {
                        if (state.min < min && state.min != Long.MAX_VALUE) min = state.min;
                        if (state.max > max && state.max != Long.MIN_VALUE) max = state.max;
                      }
                      if (min == Long.MAX_VALUE || max == Long.MIN_VALUE) return 0;
                      // Cap at 2 hours (7,200,000 ms) to avoid unreasonable values
                      long duration = max - min;
                      return duration > 7200000 ? 7200000 : duration;
                    `,
                  },
                },
              },
            },
            avg_interactions_per_session: {
              avg_bucket: {
                buckets_path: "thread_sessions>interactions.value",
              },
            },
            avg_duration_per_session: {
              avg_bucket: {
                buckets_path: "thread_sessions>session_duration.value",
              },
            },
          },
          query: generateTracesPivotQueryConditions({
            ...input,
            startDate,
            endDate,
          }).pivotIndexConditions,
          size: 0,
        },
        filter_path: [
          "aggregations.total_users",
          "aggregations.total_sessions",
          "aggregations.avg_interactions_per_session",
          "aggregations.avg_duration_per_session",
        ],
      });

    const [currentPeriod, previousPeriod] = await Promise.all([
      sessionsQuery(input.startDate, input.endDate),
      sessionsQuery(previousPeriodStartDate.getTime(), input.startDate),
    ]);

    const mapAggregations = ({ aggregations }: { aggregations: any }) => {
      return {
        total_users: aggregations.total_users.value || 0,
        total_sessions: aggregations.total_sessions.value || 0,

        average_sessions_per_user:
          (aggregations.total_sessions.value || 0) /
          (aggregations.total_users.value || 1),
        average_interactions_per_session: Math.round(
          aggregations.avg_interactions_per_session?.value || 0
        ),
        average_duration_per_session: Math.round(
          (aggregations.avg_duration_per_session?.value || 0) / 1000
        ), // Convert to seconds
      };
    };

    const result = {
      currentPeriod: mapAggregations(currentPeriod as any),
      previousPeriod: mapAggregations(previousPeriod as any),
    };

    return result;
  });
