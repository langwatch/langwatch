import { useMemo } from "react";
import { reservedTraceMetadataSchema } from "../server/tracer/types.generated";
import { api } from "../utils/api";

/**
 * Hook to fetch distinct span names and metadata keys for a project.
 * Uses a dedicated ES aggregation endpoint instead of loading full traces.
 *
 * @param projectId - The project ID to fetch field names from
 * @returns Object with spanNames, metadataKeys arrays, isLoading state, and error if any
 */
export function useProjectSpanNames(projectId: string | undefined) {
  // Use last 30 days as default date range
  const endDate = useMemo(() => Date.now(), []);
  const startDate = useMemo(
    () => endDate - 30 * 24 * 60 * 60 * 1000,
    [endDate]
  );

  const fieldNames = api.traces.getFieldNames.useQuery(
    {
      projectId: projectId ?? "",
      startDate,
      endDate,
    },
    {
      enabled: !!projectId,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  );

  const metadataKeys = useMemo(() => {
    if (!fieldNames.data) {
      return [];
    }

    // Merge ES results with reserved keys (which should always appear)
    const reservedKeys = Object.keys(reservedTraceMetadataSchema.shape);
    const esKeys = fieldNames.data.metadataKeys.map((k) => k.key);
    const allKeys = Array.from(new Set([...esKeys, ...reservedKeys]));

    const excludedKeys = ["custom", "all_keys"];
    return allKeys
      .filter((key) => !excludedKeys.includes(key))
      .map((key) => ({ key, label: key }));
  }, [fieldNames.data]);

  return {
    spanNames: fieldNames.data?.spanNames ?? [],
    metadataKeys,
    isLoading: fieldNames.isLoading,
    error: fieldNames.error,
  };
}
