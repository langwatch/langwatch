import { useMemo } from "react";
import { api } from "../../behavior/trace-api";

/**
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
    },
  );

  const eventTypes = useMemo(
    () =>
      (query.data?.options ?? [])
        .map((option) => ({
          key: String(option.field),
          label: option.label,
        }))
        .filter((option) => option.key !== ""),
    [query.data],
  );

  return {
    eventTypes,
    isLoading: query.isLoading,
    error: query.error,
  };
}
