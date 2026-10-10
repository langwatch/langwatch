/**
 * Freshness probe for the run history views.
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { scenarioClient } from "@langwatch/scenario-client";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { useEffect, useRef } from "react";

import { getAdaptivePollingInterval } from "../../model/suite/adaptive-polling-interval.ts";

interface UseSuiteRunFreshnessOptions {
  /** When provided, scopes the probe to a single scenario set. */
  scenarioSetId?: string;
  startDateMs: number;
  endDateMs?: number;
  /** Currently loaded runs — their statuses drive the polling cadence. */
  runs: readonly Pick<ScenarioRunData, "status">[];
  enabled: boolean;
  /** While the SSE stream is connected, the probe does not poll. */
  sseConnected: boolean;
  /** The suites page polls while the stream is down; the Agent Testing results set no timer. */
  adaptivePolling?: boolean;
}

export function useSuiteRunFreshness({
  scenarioSetId,
  startDateMs,
  endDateMs,
  runs,
  enabled,
  sseConnected,
  adaptivePolling = false,
}: UseSuiteRunFreshnessOptions) {
  const { project } = useOrganizationTeamProject();
  const utils = scenarioClient.useUtils();

  const { data } = scenarioClient.scenarios.getSuiteRunFreshness.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
      startDate: startDateMs,
      endDate: endDateMs,
    },
    {
      enabled: !!project && enabled,
      ...(adaptivePolling && !sseConnected
        ? { refetchInterval: getAdaptivePollingInterval({ runs }) }
        : {}),
    },
  );

  // Invalidate the heavy run-data query only when freshness advances past the last
  // observed value within the current probe scope.
  const scopeKey = `${project?.id ?? ""}:${scenarioSetId ?? ""}:${startDateMs}:${endDateMs ?? ""}`;
  const lastSeenRef = useRef<number | null>(null);
  const lastScopeRef = useRef(scopeKey);
  useEffect(() => {
    if (lastScopeRef.current !== scopeKey) {
      lastScopeRef.current = scopeKey;
      lastSeenRef.current = null;
    }
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
  }, [scopeKey, data?.lastUpdatedAt, utils]);
}
