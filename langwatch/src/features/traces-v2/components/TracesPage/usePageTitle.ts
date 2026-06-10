import { useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawerStore } from "../../stores/drawerStore";
import { useFilterStore } from "../../stores/filterStore";

const BASE_TITLE = "LangWatch";
const TRACE_ID_LENGTH = 8;
const MAX_QUERY_LENGTH = 60;

function buildTitle({
  projectName,
  drawerTraceId,
  queryText,
  timeRangeLabel,
}: {
  projectName: string | undefined;
  drawerTraceId: string | null;
  queryText: string;
  timeRangeLabel: string | undefined;
}): string {
  const prefix = projectName ? `${BASE_TITLE} – ${projectName}` : BASE_TITLE;

  if (drawerTraceId) {
    return `${prefix} – Trace ${drawerTraceId.slice(0, TRACE_ID_LENGTH)}`;
  }

  const trimmed = queryText.trim();
  if (trimmed) {
    const clipped =
      trimmed.length > MAX_QUERY_LENGTH
        ? `${trimmed.slice(0, MAX_QUERY_LENGTH - 1)}…`
        : trimmed;
    return `${prefix} – Traces · ${clipped}`;
  }

  if (timeRangeLabel) {
    return `${prefix} – Traces · ${timeRangeLabel}`;
  }

  return `${prefix} – Traces`;
}

/**
 * Keeps `document.title` in sync with the trace view's drawer + filter
 * state. The microtask defer ensures this runs after `DashboardLayout`'s
 * own title-setting effect on the same commit (parent effects run last,
 * so we schedule a microtask that fires after both have committed).
 */
export function useTracesPageTitle(): void {
  const { project } = useOrganizationTeamProject();
  const drawerOpen = useDrawerStore((s) => s.isOpen);
  const drawerTraceId = useDrawerStore((s) => s.traceId);
  const queryText = useFilterStore((s) => s.queryText);
  const timeRangeLabel = useFilterStore((s) => s.timeRange.label);

  const activeTraceId = drawerOpen ? drawerTraceId : null;

  useEffect(() => {
    const title = buildTitle({
      projectName: project?.name,
      drawerTraceId: activeTraceId,
      queryText,
      timeRangeLabel,
    });
    queueMicrotask(() => {
      document.title = title;
    });
  }, [project?.name, activeTraceId, queryText, timeRangeLabel]);
}
