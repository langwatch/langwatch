import {
  SPAN_INDEX,
  TRACES_PIVOT_INDEX,
  esClient,
  traceIndexId,
} from "../../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { generateTracesPivotQueryConditions } from "./common";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import type { ElasticSearchEvent } from "../../../tracer/types";

export const feedbacks = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkUserPermissionForProject(TeamRoleGroup.COST_VIEW))
  .query(async ({ input }) => {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

    const result = (await esClient.search({
      index: TRACES_PIVOT_INDEX,
      size: 100,
      body: {
        _source: ["events"],
        query: {
          bool: {
            must: [
              pivotIndexConditions,
              {
                nested: {
                  path: "events",
                  query: {
                    bool: {
                      must: [
                        {
                          term: { "events.event_type": "thumbs_up_down" },
                        },
                        {
                          nested: {
                            path: "events.event_details",
                            query: {
                              bool: {
                                must: [
                                  {
                                    term: {
                                      "events.event_details.key": "feedback",
                                    },
                                  },
                                ] as QueryDslQueryContainer[],
                              } as QueryDslBoolQuery,
                            },
                          },
                        },
                      ] as QueryDslQueryContainer[],
                    } as QueryDslBoolQuery,
                  },
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    }));

    const events: ElasticSearchEvent[] = result.hits.hits
      .flatMap((hit: any) => hit._source.events)
      .filter(
        (event: any) =>
          event.event_details?.some((detail: any) => detail.key === "feedback")
      )
      .map((event: any) => ({
        ...event,
        timestamps: {
          started_at:
            "timestamps" in event
              ? event.timestamps.started_at
              : event["timestamps.started_at"],
          inserted_at:
            "timestamps" in event
              ? event.timestamps.inserted_at
              : event["timestamps.inserted_at"],
          updated_at:
            "timestamps" in event
              ? event.timestamps.updated_at
              : event["timestamps.updated_at"],
        },
      }));

    return {
      events,
    };
  });
