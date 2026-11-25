// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { useMemo } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { type Breakdowns } from "../model/breakdowns.ts";
import { type DailyBucket, type RankRow } from "../model/sample-series.ts";

/**
 * The reads under the breakdown panels.
 *
 * THE BY-TEAM CHART IS GONE and its read with it. `activityMonitor
 * .spendOverTime` grouped by team was the last caller of the metered trace
 * store on this screen's time axis, and it drew a chart nobody could act on:
 * a team is not a thing this product's cost rows carry, so every bar it ever
 * drew outside sample mode was one unattributed block. The panel was removed
 * at the product owner's direction and the read went with it rather than
 * staying to be paid for on every page load.
 */
export function useBreakdownQueries({
  organizationId,
  windowDays,
  enabled,
}: {
  organizationId: string;
  windowDays: number;
  enabled: boolean;
}): Breakdowns {
  const args = { organizationId, windowDays };
  const options = { enabled, refetchOnWindowFocus: false };

  const summary = api.activityMonitor.summary.useQuery(args, options);
  const byDepartment = api.activityMonitor.spendByDepartment.useQuery(args, options);
  const byUser = api.activityMonitor.spendByUser.useQuery({ ...args, limit: 8 }, options);
  // The PULLED rollup, not the metered trace store the panels around it read.
  // ADR-128 §1 files the model under wave 1 because the bill already carries
  // it, and it is the only one of wave 1's "where" dimensions that pulled rows
  // actually fill — so this panel can be a measurement while its neighbours
  // wait on gateway traffic (by team, by person) or on wave 2 (by department).
  // Pointed at the traces it reported "nothing in this window yet" over a
  // table holding every model the organization had been billed for.
  const byModel = api.governanceCost.spendByModel.useQuery(args, options);

  const departmentRows = byDepartment.data ?? null;
  // The picker is the one place an unanswered read may fall back to empty: it
  // offers choices, it does not report a measurement. Memoised because the
  // selection reset watches this list, and a fresh array every render would
  // wake that effect on every render.
  const departments = useMemo(
    () =>
      (departmentRows ?? []).map((row) => ({
        id: row.departmentId ?? "unassigned",
        name: row.departmentName,
      })),
    [departmentRows],
  );
  return {
    departmentRows,
    departments,
    userRows: byUser.data ?? null,
    activeUsers: summary.data?.activeUsersThisWindow ?? null,
    failed: {
      byDepartment: byDepartment.isError,
      byUser: byUser.isError,
      byModel: byModel.isError,
    },
    isFetching:
      summary.isFetching || byDepartment.isFetching || byUser.isFetching || byModel.isFetching,
    refetchAll: () => {
      // Every read, including the model one that now comes from a different
      // router than its neighbours: refreshing some panels and leaving others
      // stale is the half-refresh this control exists against, and which
      // procedure a panel happens to call is not a reason to skip it.
      void summary.refetch();
      void byDepartment.refetch();
      void byUser.refetch();
      void byModel.refetch();
    },
    // `.rows`, and only once the read has answered: an unanswered read stays
    // null so the panel draws its empty state rather than a measured zero.
    modelRows: byModel.data?.rows ?? null,
  };
}

/** Total each series across the window, for the ranked and donut panels. */
export function totalPerSeries(buckets: DailyBucket[]): RankRow[] {
  const totals = new Map<string, RankRow>();
  for (const bucket of buckets) {
    for (const point of bucket.points) {
      const existing = totals.get(point.key);
      if (existing) {
        existing.value += point.value;
      } else {
        totals.set(point.key, { ...point });
      }
    }
  }
  return [...totals.values()];
}
