import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { TRACE_INDEX, esClient } from "../../../elasticsearch";
import {
  type ElasticSearchEvent,
  type ElasticSearchTrace,
} from "../../../tracer/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { generateTracesPivotQueryConditions } from "./common";

export const feedbacks = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkUserPermissionForProject(TeamRoleGroup.COST_VIEW))
  .query(async ({ input }) => {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

    const client = await esClient(undefined, input.projectId);
    const result = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
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
    });

    const events: ElasticSearchEvent[] = result.hits.hits
      .flatMap((hit) => hit._source!.events ?? [])
      .filter(
        (event) =>
          event.event_details?.some((detail) => detail.key === "feedback")
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
