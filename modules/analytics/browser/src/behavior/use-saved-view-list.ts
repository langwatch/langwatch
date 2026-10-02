import type { OutputsFromMap } from "@langwatch/api/web";
import { useMemo } from "react";
import { z } from "zod";

import type { SavedView } from "../model/saved-views-logic.ts";
import { analyticsApi, type AnalyticsApiMap } from "./analytics-api.ts";

/** One stored view as the browser receives it, derived from the contract output. */
export type StoredSavedView = OutputsFromMap<AnalyticsApiMap>["savedViews"]["getAll"][number];

const filterParamSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), z.array(z.string())),
  z.record(z.string(), z.record(z.string(), z.array(z.string()))),
]);

const storedViewRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  userId: z.string().nullish(),
  filters: z.record(z.string(), filterParamSchema).catch({}),
  query: z.string().nullish(),
  period: z
    .object({
      relativeDays: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })
    .nullish()
    .catch(undefined),
});

/** Parses the wire rows once: stored filters and period are free JSON until checked. */
function toClientViews(rows: StoredSavedView[] | undefined): SavedView[] | undefined {
  const parsed = z.array(storedViewRowSchema).safeParse(rows);
  if (!parsed.success) return undefined;
  return parsed.data.map((row) => ({
    id: row.id,
    name: row.name,
    userId: row.userId,
    filters: row.filters,
    query: row.query ?? undefined,
    period: row.period ?? undefined,
  }));
}

/** The project's saved views, derived from the cached server read. */
export function useSavedViewList(projectId: string) {
  const query = analyticsApi.savedViews.getAll.useQuery({ projectId }, { enabled: !!projectId });
  const customViews = useMemo(() => toClientViews(query.data) ?? [], [query.data]);
  return { customViews, isInitialized: query.isFetched };
}
