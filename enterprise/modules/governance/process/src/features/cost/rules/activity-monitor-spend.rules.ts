// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The pure folds behind the activity monitor's spend reads: trace spend rows rolled into
 * departments, teams and a dense daily series. Money accumulates in nano-USD integers.
 * @see specs/ai-gateway/governance/birds-eye-dashboard-v2.feature
 */
import {
  type GovernanceSortDirection,
  resolveTraceDepartmentId,
  type SpendByDepartmentRow,
  type SpendByTeamRow,
  type SpendOverTimeBucket,
  type SpendSortField,
  UNASSIGNED_DEPARTMENT,
} from "@langwatch/enterprise-governance-contract";
import { nanoUsdToDecimalString, usdToNanoUsd } from "@langwatch/gateway-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORG_WIDE_KEY = "__org_wide__";
const ORG_WIDE_LABEL = "Org-wide";

/** A source's owning team as Postgres reads it; `null` rolls up under Org-wide. */
export type SourceTeam = { id: string; name: string } | null;

/** Who a principal user's spend belongs to, and which departments are live. */
export interface DepartmentDirectory {
  projectDepartmentById: Map<string, string | null>;
  userDepartmentByEmail: Map<string, string | null>;
  userTeamDepartmentByEmail: Map<string, string | null>;
  activeDepartmentNames: Map<string, string>;
}

export function pctChange({ current, previous }: { current: number; previous: number }): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

/** An epoch-millisecond moment as the wire's ISO string, milliseconds always shown. */
export function isoOf(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toString({ fractionalSecondDigits: 3 });
}

export function startOfUtcDay(ms: number): number {
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO("UTC").startOfDay()
    .epochMilliseconds;
}

export function emptyDenseBuckets({
  windowStartMs,
  windowDays,
}: {
  windowStartMs: number;
  windowDays: number;
}): SpendOverTimeBucket[] {
  return Array.from({ length: windowDays }, (_, i) => ({
    bucketIso: isoOf(windowStartMs + i * DAY_MS),
    points: [],
  }));
}

function byNanoUsdDescending(a: { spendUsd: string }, b: { spendUsd: string }): number {
  const aNano = usdToNanoUsd(a.spendUsd);
  const bNano = usdToNanoUsd(b.spendUsd);
  if (bNano > aNano) return 1;
  if (bNano < aNano) return -1;
  return 0;
}

/** Per (project, principal user) spend resolved to departments; unknown ones are Unassigned. */
export function rollDepartmentSpend({
  rows,
  directory,
}: {
  rows: readonly {
    projectId: string;
    value: string;
    spentUsd: string;
    requests: number;
    lastOccurredAtMs: number;
  }[];
  directory: DepartmentDirectory;
}): SpendByDepartmentRow[] {
  const acc = new Map<
    string,
    { spendNanoUsd: bigint; requestCount: number; lastActivityMs: number }
  >();
  for (const row of rows) {
    const departmentId = resolveTraceDepartmentId({
      hasPrincipalUser: row.value !== "",
      userDepartmentId: directory.userDepartmentByEmail.get(row.value),
      userTeamDepartmentId: directory.userTeamDepartmentByEmail.get(row.value),
      projectDepartmentId: directory.projectDepartmentById.get(row.projectId) ?? null,
    });
    const key =
      departmentId !== UNASSIGNED_DEPARTMENT && directory.activeDepartmentNames.has(departmentId)
        ? departmentId
        : UNASSIGNED_DEPARTMENT;
    const prior = acc.get(key) ?? { spendNanoUsd: 0n, requestCount: 0, lastActivityMs: 0 };
    acc.set(key, {
      spendNanoUsd: prior.spendNanoUsd + usdToNanoUsd(row.spentUsd),
      requestCount: prior.requestCount + row.requests,
      lastActivityMs: Math.max(prior.lastActivityMs, row.lastOccurredAtMs),
    });
  }
  return [...acc.entries()]
    .map(([key, v]) => ({
      departmentId: key === UNASSIGNED_DEPARTMENT ? null : key,
      departmentName:
        key === UNASSIGNED_DEPARTMENT ? "Unassigned" : directory.activeDepartmentNames.get(key)!,
      spendUsd: nanoUsdToDecimalString(v.spendNanoUsd),
      requestCount: v.requestCount,
      lastActivityIso: v.lastActivityMs > 0 ? isoOf(v.lastActivityMs) : null,
    }))
    .toSorted(byNanoUsdDescending);
}

const TEAM_ROW_SORT_KEYS: Record<
  SpendSortField,
  (row: { thisSpendNano: bigint; requestCount: number; lastActivityMs: number }) => number
> = {
  spend: (r) => Number(r.thisSpendNano),
  requests: (r) => r.requestCount,
  lastActivity: (r) => r.lastActivityMs,
};

/** Per-source spend rolled into teams (Org-wide when unowned), then sorted and paged. */
export function rollTeamSpend({
  rows,
  teamBySource,
  sortBy,
  sortDir,
  limit,
  offset,
}: {
  rows: readonly {
    value: string;
    currentSpendUsd: string;
    previousSpendUsd: string;
    currentRequests: number;
    lastCurrentOccurredAtMs: number;
  }[];
  teamBySource: ReadonlyMap<string, SourceTeam>;
  sortBy: SpendSortField;
  sortDir: GovernanceSortDirection;
  limit: number;
  offset: number;
}): SpendByTeamRow[] {
  const byTeam = new Map<
    string,
    {
      teamId: string | null;
      teamName: string;
      thisSpendNano: bigint;
      prevSpendNano: bigint;
      requestCount: number;
      lastActivityMs: number;
      sourceCount: number;
    }
  >();
  for (const row of rows) {
    const team = teamBySource.get(row.value) ?? null;
    const key = team ? team.id : ORG_WIDE_KEY;
    const thisSpendNano = usdToNanoUsd(row.currentSpendUsd);
    const prevSpendNano = usdToNanoUsd(row.previousSpendUsd);
    const existing = byTeam.get(key);
    if (existing) {
      existing.thisSpendNano += thisSpendNano;
      existing.prevSpendNano += prevSpendNano;
      existing.requestCount += row.currentRequests;
      existing.sourceCount += 1;
      existing.lastActivityMs = Math.max(existing.lastActivityMs, row.lastCurrentOccurredAtMs);
    } else {
      byTeam.set(key, {
        teamId: team?.id ?? null,
        teamName: team?.name ?? ORG_WIDE_LABEL,
        thisSpendNano,
        prevSpendNano,
        requestCount: row.currentRequests,
        lastActivityMs: row.lastCurrentOccurredAtMs,
        sourceCount: 1,
      });
    }
  }

  const sortKey = TEAM_ROW_SORT_KEYS[sortBy];
  const sign = sortDir === "asc" ? 1 : -1;
  return [...byTeam.values()]
    .filter((t) => t.thisSpendNano > 0n || t.requestCount > 0)
    .toSorted((a, b) => sign * (sortKey(a) - sortKey(b)))
    .slice(offset, offset + limit)
    .map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      spendUsd: nanoUsdToDecimalString(t.thisSpendNano),
      requestCount: t.requestCount,
      deltaPctVsPriorWindow: pctChange({
        current: Number(t.thisSpendNano),
        previous: Number(t.prevSpendNano),
      }),
      hasPriorBaseline: t.prevSpendNano > 0n,
      lastActivityIso: t.lastActivityMs > 0 ? isoOf(t.lastActivityMs) : null,
      sourceCount: t.sourceCount,
    }));
}

/**
 * Daily group spend folded into a dense series: empty days stay as `points: []`, each day's
 * points sort by spend. `teamBySource` given means the group values are source ids rolled
 * into teams; otherwise each non-empty value is its own group.
 */
export function rollSpendOverTime({
  rows,
  windowStartMs,
  windowDays,
  teamBySource,
}: {
  rows: readonly { dayStartMs: number; value: string | null; spentUsd: string }[];
  windowStartMs: number;
  windowDays: number;
  teamBySource?: ReadonlyMap<string, SourceTeam>;
}): SpendOverTimeBucket[] {
  const labelByKey = new Map<string, string>();
  const aggregated = new Map<string, bigint>();
  for (const row of rows) {
    const value = row.value ?? "";
    if (!value) continue;
    let key = value;
    let label = value;
    if (teamBySource) {
      const team = teamBySource.get(value) ?? null;
      key = team?.id ?? ORG_WIDE_KEY;
      label = team?.name ?? ORG_WIDE_LABEL;
    }
    labelByKey.set(key, label);
    const composite = `${row.dayStartMs}::${key}`;
    aggregated.set(composite, (aggregated.get(composite) ?? 0n) + usdToNanoUsd(row.spentUsd));
  }

  const buckets = emptyDenseBuckets({ windowStartMs, windowDays });
  const bucketIndexByMs = new Map<number, number>();
  for (const [index, bucket] of buckets.entries()) {
    bucketIndexByMs.set(toEpochMs(bucket.bucketIso), index);
  }
  for (const [composite, spendNanoUsd] of aggregated.entries()) {
    const separator = composite.indexOf("::");
    const index = bucketIndexByMs.get(Number(composite.slice(0, separator)));
    const key = composite.slice(separator + 2);
    const label = labelByKey.get(key);
    if (index === undefined || label === undefined || spendNanoUsd <= 0n) continue;
    buckets[index]!.points.push({ key, label, spendUsd: nanoUsdToDecimalString(spendNanoUsd) });
  }
  for (const bucket of buckets) bucket.points.sort(byNanoUsdDescending);
  return buckets;
}
