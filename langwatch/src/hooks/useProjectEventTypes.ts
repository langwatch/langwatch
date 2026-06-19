import { useMemo } from "react";
import { api } from "../utils/api";

/**
 * Hook to fetch the distinct event types a project produced, for the events
 * field-mapping dropdown.
 *
 * Event types live only inside the heavy `stored_spans.SpanAttributes` map
 * (the trace_summaries event columns were dropped in migration 00025), so they
 * are NOT served from `getDistinctFieldNames` — a full scan there would trip
 * the memory-safety guard. Instead this reuses the same bounded, prod-proven
 * query that backs the analytics "event type" filter dropdown
 * (`dataForFilter` -> filter options: GROUP BY + LIMIT 10000 over the date
 * range), which returns the clean custom event types that match the dataset
 * mapping's `event_type` keys.
 *
 * The query is bounded but not free, so callers should pass `enabled: false`
 * until an events column is actually being mapped.
 *
 * @param projectId - The project ID to fetch event types for
 * @param enabled - Gate the query (default true); combined with projectId presence
 * @returns Object with eventTypes array, isLoading state, and error if any
 */
export function useProjectEventTypes({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  const endDate = useMemo(() => Date.now(), []);
  const startDate = useMemo(() => endDate - 30 * 24 * 60 * 60 * 1000, [endDate]);

  const query = api.analytics.dataForFilter.useQuery(
    {
      projectId: projectId ?? "",
      startDate,
      endDate,
      filters: {},
      field: "events.event_type",
    },
    {
      enabled: !!projectId && enabled,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  );

  const eventTypes = useMemo(
    () =>
      (query.data?.options ?? [])
        .map((option) => ({
          key: String(option.field),
          label: option.label,
        }))
        .filter((option) => option.key !== ""),
    [query.data]
  );

  return {
    eventTypes,
    isLoading: query.isLoading,
    error: query.error,
  };
}
