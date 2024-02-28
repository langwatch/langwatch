import { TRACES_PIVOT_INDEX, esClient } from "../../../elasticsearch";
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
    const { previousPeriodStartDate } = currentVsPreviousDates(input);

    const sessionsQuery = (startDate: number, endDate: number) =>
      esClient.search({
        index: TRACES_PIVOT_INDEX,
        body: {
          aggs: {
            user_sessions: {
              terms: {
                field: "trace.metadata.user_id",
                size: 10000, // Adjust based on expected number of unique users
              },
              aggs: {
                session_windows: {
                  date_histogram: {
                    field: "trace.timestamps.started_at",
                    calendar_interval: "hour", // Group by hour
                  },
                  aggs: {
                    distinct_threads: {
                      cardinality: {
                        field: "trace.metadata.thread_id",
                      },
                    },
                    session_duration: {
                      scripted_metric: {
                        init_script: "state.duration = 0",
                        map_script: `
                          if (doc.containsKey('trace.timestamps.started_at') && doc['trace.timestamps.started_at'].size() > 0) {
                            long startedAt = doc['trace.timestamps.started_at'].value.toInstant().toEpochMilli();
                            if (state.min_started_at == null || startedAt < state.min_started_at) {
                              state.min_started_at = startedAt;
                            }
                            if (state.max_started_at == null || startedAt > state.max_started_at) {
                              state.max_started_at = startedAt;
                              state.total_time_ms = doc.containsKey('trace.metrics.total_time_ms') && doc['trace.metrics.total_time_ms'].size() > 0 ? doc['trace.metrics.total_time_ms'].value : 0;
                            }
                          }
                        `,
                        combine_script: "return state",
                        reduce_script: `
                          long minStartedAt = Long.MAX_VALUE;
                          long maxStartedAt = Long.MIN_VALUE;
                          long totalTimeMs = 0;
                          for (state in states) {
                            if (state != null) {
                              if (state.min_started_at != null && state.min_started_at < minStartedAt) {
                                minStartedAt = state.min_started_at;
                              }
                              if (state.max_started_at != null && state.max_started_at > maxStartedAt) {
                                maxStartedAt = state.max_started_at;
                                totalTimeMs = state.total_time_ms;
                              }
                            }
                          }
                          return (maxStartedAt + totalTimeMs) - minStartedAt;
                        `,
                      },
                    },
                  },
                },
                average_threads_per_session: {
                  avg_bucket: {
                    buckets_path: "session_windows>distinct_threads",
                  },
                },
                average_session_duration: {
                  avg_bucket: {
                    buckets_path: "session_windows>session_duration.value",
                  },
                },
                returning_user_flag: {
                  bucket_script: {
                    buckets_path: {
                      numSessions: "session_windows._bucket_count",
                    },
                    script: "params.numSessions > 1 ? 1 : 0",
                  },
                },
                bouncing_user_flag: {
                  bucket_script: {
                    buckets_path: {
                      numTraces: "_count",
                    },
                    script: "params.numTraces == 1 ? 1 : 0",
                  },
                },
              },
            },
            total_users: {
              cardinality: {
                field: "trace.metadata.user_id",
              },
            },
            total_sessions: {
              sum_bucket: {
                buckets_path: "user_sessions>session_windows._bucket_count",
              },
            },
            average_threads_per_user_session: {
              avg_bucket: {
                buckets_path: "user_sessions>average_threads_per_session",
              },
            },
            average_duration_per_user_session: {
              avg_bucket: {
                buckets_path: "user_sessions>average_session_duration",
              },
            },
            returning_users_count: {
              sum_bucket: {
                buckets_path: "user_sessions>returning_user_flag",
              },
            },
            bouncing_users_count: {
              sum_bucket: {
                buckets_path: "user_sessions>bouncing_user_flag",
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
          "aggregations.average_threads_per_user_session",
          "aggregations.average_duration_per_user_session",
          "aggregations.returning_users_count",
          "aggregations.bouncing_users_count",
        ],
      });

    const [currentPeriod, previousPeriod] = await Promise.all([
      sessionsQuery(input.startDate, input.endDate),
      sessionsQuery(previousPeriodStartDate.getTime(), input.startDate),
    ]);

    const mapAggregations = ({ aggregations }: { aggregations: any }) => {
      return {
        total_users: aggregations.total_users.value,
        total_sessions: aggregations.total_sessions.value,
        returning_users_count: aggregations.returning_users_count.value,
        bouncing_users_count: aggregations.bouncing_users_count.value,
        average_sessions_per_user:
          (aggregations.total_sessions.value || 0) /
          (aggregations.total_users.value || 1),
        average_threads_per_user_session:
          aggregations.average_threads_per_user_session.value || 0,
        average_duration_per_user_session: Math.round(
          aggregations.average_duration_per_user_session.value || 0
        ),
      };
    };

    const result = {
      currentPeriod: mapAggregations(currentPeriod as any),
      previousPeriod: mapAggregations(previousPeriod as any),
    };

    return result;
  });
