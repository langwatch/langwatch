import { SCENARIO_EVENTS_INDEX } from "~/server/elasticsearch";
import type { AggregationsCalendarInterval } from "@elastic/elasticsearch/lib/api/types";
import { ScenarioEventType } from "~/app/api/scenario-events/[[...route]]/enums";

export interface ScenarioAnalyticsQueryOptions {
  projectId: string;
  eventType: string;
  startTime: number;
  endTime: number;
  includeDateHistogram?: boolean;
  dateHistogramOptions?: {
    calendarInterval: AggregationsCalendarInterval;
    format: string;
    timeZone: string;
  };
}

/**
 * Creates Elasticsearch query for scenario analytics
 * @param options Query configuration options
 * @returns Array containing index and query objects for msearch
 */
export function createScenarioAnalyticsQuery(
  options: ScenarioAnalyticsQueryOptions
) {
  const {
    projectId,
    eventType,
    startTime,
    endTime,
    includeDateHistogram = false,
    dateHistogramOptions = {
      calendarInterval: "day" as AggregationsCalendarInterval,
      format: "yyyy-MM-dd",
      timeZone: "UTC",
    },
  } = options;

  const typeFilter = eventType === "*" ? [] : [{ term: { type: eventType } }];

  const baseQuery = {
    size: 0,
    query: {
      bool: {
        must: [
          {
            bool: {
              should: [
                { term: { "metadata.project_id": projectId } },
                { term: { project_id: projectId } },
              ],
              minimum_should_match: 1,
            },
          },
          ...typeFilter,
          {
            range: {
              timestamp: {
                gte: startTime,
                lt: endTime,
              },
            },
          },
        ],
      },
    },
  };

  // Add date histogram aggregation if requested
  if (includeDateHistogram) {
    return [
      { index: SCENARIO_EVENTS_INDEX.alias },
      {
        ...baseQuery,
        aggs: {
          daily_counts: {
            date_histogram: {
              field: "timestamp",
              calendar_interval: dateHistogramOptions.calendarInterval,
              format: dateHistogramOptions.format,
              time_zone: dateHistogramOptions.timeZone,
            },
          },
        },
      },
    ];
  }

  return [{ index: SCENARIO_EVENTS_INDEX.alias }, baseQuery];
}

/**
 * Creates multiple scenario analytics queries for all event types
 * @param projectId Project ID
 * @param startTime Start timestamp
 * @param endTime End timestamp
 * @param includeDateHistogram Whether to include date histogram aggregation
 * @param dateHistogramOptions Date histogram configuration
 * @returns Array of query objects for msearch
 */
export function createScenarioAnalyticsQueriesForAllEventTypes(
  projectId: string,
  startTime: number,
  endTime: number,
  includeDateHistogram = false,
  dateHistogramOptions?: {
    calendarInterval: AggregationsCalendarInterval;
    format: string;
    timeZone: string;
  }
) {
  const eventTypes = [
    "*",
    ScenarioEventType.MESSAGE_SNAPSHOT,
    ScenarioEventType.RUN_STARTED,
    ScenarioEventType.RUN_FINISHED,
  ];

  return eventTypes.flatMap((eventType) =>
    createScenarioAnalyticsQuery({
      projectId,
      eventType,
      startTime,
      endTime,
      includeDateHistogram,
      dateHistogramOptions,
    })
  );
}
