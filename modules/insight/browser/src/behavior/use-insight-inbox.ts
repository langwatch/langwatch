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

export type InsightInboxReading = Readonly<{
  /** False while the flag, the grant or the project is missing: draw nothing. */
  available: boolean;
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
  const available =
    project !== undefined && host.isEnabled() === true && host.hasPermission("analytics:view");
  const query = insightApi.insights.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: available },
  );
  const derived = useMemo(() => {
    const now = nowInstant().epochMilliseconds;
    return {
      now,
      inbox: query.data ? deriveInsightInbox({ entries: query.data, now }) : undefined,
    };
  }, [query.data]);

  return {
    available,
    project,
    inbox: derived.inbox,
    now: derived.now,
    isLoading: available && query.isLoading,
    error: query.error,
    retry: () => void query.refetch(),
  };
}
