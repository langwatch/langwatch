import type { FilterField } from "../model/analytics-filter-definition.ts";
import {
  analyticsApi,
  type AnalyticsFilterOption,
  type AnalyticsSubtopicCount,
  type AnalyticsTopicCount,
} from "./analytics-api.ts";
import { useFilterParams } from "./use-filter-params.ts";

export type TopicCounts = {
  topicCounts: AnalyticsTopicCount[];
  subtopicCounts: AnalyticsSubtopicCount[];
};

/** The options a filter field offers under the current filters; keeps the last answer on screen. */
export function useFilterOptions({
  field,
  key,
  subkey,
  query,
}: {
  field: FilterField;
  key?: string | undefined;
  subkey?: string | undefined;
  query?: string;
}) {
  const { filterParams, queryOpts } = useFilterParams();
  return analyticsApi.analytics.dataForFilter.useQuery(
    {
      ...filterParams,
      field,
      key,
      subkey,
      ...(query === undefined ? {} : { query }),
    },
    {
      refetchOnMount: false,
      placeholderData: (previous?: { options: AnalyticsFilterOption[] }) => previous,
      enabled: queryOpts.enabled,
    },
  );
}

/** Topic and subtopic counts under the current filters, minus the topic selection itself. */
export function useTopicCounts() {
  const { filterParams, queryOpts } = useFilterParams();
  return analyticsApi.traces.getTopicCounts.useQuery(
    {
      ...filterParams,
      filters: {
        ...filterParams.filters,
        "topics.topics": [],
        "topics.subtopics": [],
      },
    },
    {
      ...queryOpts,
      placeholderData: (previous?: TopicCounts) => previous,
    },
  );
}
