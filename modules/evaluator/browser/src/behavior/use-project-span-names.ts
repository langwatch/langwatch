import { nowInstant } from "@langwatch/time";
import {
  type DistinctFieldNamesResult,
  reservedTraceMetadataSchema,
} from "@langwatch/trace-contract";
import { useMemo } from "react";

import { evaluatorApi } from "./evaluator-api.ts";

const EXCLUDED_METADATA_KEYS = ["custom", "all_keys"];

/** The project's span names and metadata keys from the last 30 days, reserved keys included. */
export function useProjectSpanNames({ projectId }: { projectId: string | undefined }) {
  const endDate = useMemo(() => nowInstant().epochMilliseconds, []);
  const startDate = useMemo(() => endDate - 30 * 24 * 60 * 60 * 1000, [endDate]);
  const fieldNames = evaluatorApi.traces.getFieldNames.useQuery(
    { projectId: projectId ?? "", startDate, endDate },
    { enabled: !!projectId },
  );
  const data: DistinctFieldNamesResult | undefined = fieldNames.data;

  const metadataKeys = useMemo(() => {
    if (!data) return [];
    const reservedKeys = Object.keys(reservedTraceMetadataSchema.shape);
    const allKeys = Array.from(new Set([...data.metadataKeys.map((k) => k.key), ...reservedKeys]));
    return allKeys
      .filter((key) => !EXCLUDED_METADATA_KEYS.includes(key))
      .map((key) => ({ key, label: key }));
  }, [data]);

  return { spanNames: data?.spanNames ?? [], metadataKeys };
}
