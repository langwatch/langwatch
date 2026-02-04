import { useMemo } from "react";
import { TRACE_MAPPINGS } from "../server/tracer/tracesMapping";
import { api } from "../utils/api";

/**
 * Hook to fetch and extract unique span names and metadata keys from a project's recent traces.
 * Used by both Online Evaluation and Dataset mapping UIs to show dynamic field options.
 *
 * @param projectId - The project ID to fetch traces from
 * @returns Object with spanNames, metadataKeys arrays, isLoading state, and error if any
 */
export function useProjectSpanNames(projectId: string | undefined) {
  // Use last 30 days as default date range for fetching sample traces
  const endDate = useMemo(() => Date.now(), []);
  const startDate = useMemo(
    () => endDate - 30 * 24 * 60 * 60 * 1000,
    [endDate]
  );

  const sampleTraces = api.traces.getSampleTracesDataset.useQuery(
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

  const spanNames = useMemo(() => {
    if (!sampleTraces.data || sampleTraces.data.length === 0) {
      return [];
    }
    return TRACE_MAPPINGS.spans.keys(sampleTraces.data);
  }, [sampleTraces.data]);

  const metadataKeys = useMemo(() => {
    if (!sampleTraces.data || sampleTraces.data.length === 0) {
      return [];
    }
    return TRACE_MAPPINGS.metadata.keys(sampleTraces.data);
  }, [sampleTraces.data]);

  return {
    spanNames,
    metadataKeys,
    isLoading: sampleTraces.isLoading,
    error: sampleTraces.error,
  };
}
