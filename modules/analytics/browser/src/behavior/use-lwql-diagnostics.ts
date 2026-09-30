import { lwqlMarkersFromViolations, type LwqlEditorMarker } from "@langwatch/analytics-browser-kit";
import { useDebounceValue } from "usehooks-ts";

import { analyticsApi } from "./analytics-api.ts";

const VALIDATE_DEBOUNCE_MS = 500;
const NO_MARKERS: readonly LwqlEditorMarker[] = [];

/**
 * The server's diagnostics for the statement being edited, asked once typing settles. The answer
 * is keyed by the statement it was asked about, so a superseded one is never drawn, and a failed
 * validation draws nothing: the editor keeps working and Run still asks the server.
 */
export function useLwqlDiagnostics({
  projectId,
  sql,
}: {
  projectId: string;
  sql: string;
}): readonly LwqlEditorMarker[] {
  const [settled] = useDebounceValue(sql, VALIDATE_DEBOUNCE_MS);
  const query = analyticsApi.analytics.lwql.validate.useQuery(
    { projectId, sql: settled },
    {
      enabled: projectId.length > 0 && settled.length > 0,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  if (settled !== sql || !query.data) return NO_MARKERS;

  return lwqlMarkersFromViolations(query.data.violations);
}
