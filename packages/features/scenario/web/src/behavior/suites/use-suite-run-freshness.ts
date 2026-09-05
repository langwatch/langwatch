/**
 * Freshness probe for the run history views.
 */

import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "../use-organization-team-project";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { api } from "../scenario-api";
import { getAdaptivePollingInterval } from "@langwatch/suite-web";

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
  const utils = api.useUtils();

  const { data } = api.scenarios.getSuiteRunFreshness.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
      startDate: startDateMs,
      endDate: endDateMs,
    },
    {
      enabled: !!project && enabled,
      refetchInterval: sseConnected ? false : getAdaptivePollingInterval({ runs }),
      trpc: { context: { skipBatch: true } },
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
