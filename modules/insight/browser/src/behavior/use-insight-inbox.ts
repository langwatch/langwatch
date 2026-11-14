/**
 * The inbox read, shared by the page, the bell and the sidebar count: one query, one
 * derivation (`deriveInsightInbox`), so the three never disagree. It refreshes on the
 * contract's read hints, never on a timer.
 */

import { deriveInsightInbox, type InsightInbox } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import { type InsightHostProject, useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";
import { useInsightsUnavailable } from "./use-insights-shown.ts";

export type InsightInboxReading = Readonly<{
  /** Why nothing is available: the page names an aggregate project; "off" is left to the route. */
  unavailable: "aggregate" | "off" | undefined;
  project: InsightHostProject | undefined;
  inbox: InsightInbox | undefined;
  /** The clock the folders were derived with, so rows print the same "today". */
  now: number;
  isLoading: boolean;
  error: unknown;
  retry: () => void;
}>;

export function useInsightInbox(): InsightInboxReading {
  const host = useInsightHost();
  const project = host.project();
  const unavailable = useInsightsUnavailable();
  const available = unavailable === undefined;
  const query = insightApi.insights.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: available },
  );
  const derived = useMemo(() => {
    const now = nowInstant().epochMilliseconds;
    return {
      now,
      inbox: available && query.data ? deriveInsightInbox({ entries: query.data, now }) : undefined,
    };
  }, [available, query.data]);

  return {
    unavailable,
    project,
    inbox: derived.inbox,
    now: derived.now,
    isLoading: available && query.isLoading,
    error: available ? query.error : null,
    // refetch ignores `enabled`, so a closed rule must not read through it.
    retry: () => {
      if (available) void query.refetch();
    },
  };
}
