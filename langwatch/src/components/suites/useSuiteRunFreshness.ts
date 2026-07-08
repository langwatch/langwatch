/**
 * Freshness probe for the run history views.
 *
 * Instead of re-downloading run payloads on a timer, the panels poll
 * `getSuiteRunFreshness` — a tiny `{ lastUpdatedAt }` response — and
 * invalidate the heavy `getSuiteRunData` query only when the value advances.
 *
 * Polling cadence adapts to run activity (fast while runs are executing,
 * slow when everything has settled) and pauses entirely while the SSE
 * event stream is connected, since SSE invalidations cover live updates.
 */

import { useEffect, useRef } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { getAdaptivePollingInterval } from "./getAdaptivePollingInterval";

interface UseSuiteRunFreshnessOptions {
  /** When provided, scopes the probe to a single scenario set. */
  scenarioSetId?: string;
  startDateMs: number;
  endDateMs?: number;
  /** Currently loaded runs — their statuses drive the polling cadence. */
  runs: ReadonlyArray<Pick<ScenarioRunData, "status">>;
  enabled: boolean;
  /** While the SSE stream is connected, the probe stops polling. */
  sseConnected: boolean;
}

export function useSuiteRunFreshness({
  scenarioSetId,
  startDateMs,
  endDateMs,
  runs,
  enabled,
  sseConnected,
}: UseSuiteRunFreshnessOptions) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  const { data } = api.scenarios.getSuiteRunFreshness.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
      startDate: startDateMs,
      endDate: endDateMs,
    },
    {
      enabled: !!project && enabled,
      refetchInterval: sseConnected
        ? false
        : getAdaptivePollingInterval({ runs }),
      trpc: { context: { skipBatch: true } },
    },
  );

  // Invalidate the heavy run-data query only when freshness advances past the
  // last observed value. The first observation is only recorded — the heavy
  // query has just fetched on mount, so there is nothing newer to pull.
  const lastSeenRef = useRef<number | null>(null);
  useEffect(() => {
    const lastUpdatedAt = data?.lastUpdatedAt;
    if (lastUpdatedAt === undefined) return;
    if (lastSeenRef.current === null) {
      lastSeenRef.current = lastUpdatedAt;
      return;
    }
    if (lastUpdatedAt > lastSeenRef.current) {
      lastSeenRef.current = lastUpdatedAt;
      void utils.scenarios.getSuiteRunData.invalidate();
    }
  }, [data?.lastUpdatedAt, utils]);
}
