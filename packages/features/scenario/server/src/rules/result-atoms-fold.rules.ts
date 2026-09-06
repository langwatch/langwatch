import {
  isOnPlatformSet,
  ON_PLATFORM_DISPLAY_NAME,
  DEFAULT_SET_ID,
  parseRunParametersJson,
  type AtomCost,
  type AtomCostSource,
  type AtomOutcome,
  type ResultAtom,
  type ResultGroup,
  type ResultsGroupBy,
  type RunParameterValues,
  type SeriesBucket,
  type TrendPoint,
} from "@langwatch/scenario-contract";
import { getSuiteSetId, tryExtractSuiteId } from "@langwatch/suite-contract";
import type { RawAtomRow, RawGroupRow, RawTrendRow } from "../ports/result-atoms-read.port";

export interface PlanRecord {
  slug: string;
  name: string;
}

export interface PlanIndex {
  bySetId: Map<string, PlanRecord>;
  all: { id: string; name: string; slug: string }[];
}

/**
 * Where a group row takes its title from. The two arms are told apart by
 * `kind`, so the scenario arm must be excluded from the other: a `kind`
 * holding "scenario" on both arms narrows to neither, and the map is unreachable.
 */
export type GroupTitles =
  | { kind: "scenario"; byId: Map<string, { title: string; subtitle: string }> }
  | { kind: Exclude<ResultsGroupBy, "scenario">; plans: PlanIndex };

export const runKey = (setId: string, batchRunId: string): string => `${setId}\0${batchRunId}`;

/**
 * The overrides a row carries, or null when it carries none. '' is what a
 * target with no overrides, and every run recorded before targets carried
 * any, reads as.
 */
export function targetParametersOf(raw: string): RunParameterValues | null {
  if (raw === "") {
    return null;
  }

  const parsed = parseRunParametersJson(raw);

  return Object.keys(parsed).length > 0 ? parsed : null;
}

/**
 * How a set id reads when no suite owns it: a code-pushed set keeps the
 * SDK-given name (what the pusher recognises), and the on-platform ad-hoc
 * set has its own friendly name, since its raw id is an internal namespace nobody chose.
 */
export function planFor(setId: string, plans: Map<string, PlanRecord>): PlanRecord {
  const known = plans.get(setId);
  if (known) {
    return known;
  }

  if (isOnPlatformSet(setId)) {
    return { slug: setId, name: ON_PLATFORM_DISPLAY_NAME };
  }

  const normalised = setId === "" ? DEFAULT_SET_ID : setId;

  return { slug: normalised, name: normalised };
}

export function toAtom({
  row,
  ordinalByRun,
  plans,
}: {
  row: RawAtomRow;
  ordinalByRun: Map<string, number>;
  plans: Map<string, PlanRecord>;
}): ResultAtom {
  const costSource = row.CostSource as AtomCostSource;

  return {
    planSlug: planFor(row.SetId, plans).slug,
    runId: row.BatchRunId,
    executionId: row.ScenarioRunId,
    runOrdinal: ordinalByRun.get(runKey(row.SetId, row.BatchRunId)) ?? 0,
    runAt: Number(row.RunAt),
    trigger: row.Trigger === "app" ? "app" : "code",
    note: row.Note === "" ? null : row.Note,
    scenarioId: row.ScenarioId,
    scenarioKey: row.ScenarioKey,
    scenarioName: row.ScenarioName === "" ? null : row.ScenarioName,
    targetKey: row.TargetKey,
    targetParameters: targetParametersOf(row.TargetParameters),
    targetName: row.TargetName === "" ? null : row.TargetName,
    status: row.Status,
    outcome: row.Outcome as AtomOutcome,
    durationMs: row.DurationMs === "" ? null : Number(row.DurationMs),
    // '' is the one value that means "never measured". Zero is a real answer.
    costUsd: row.CostUsd === "" ? null : Number(row.CostUsd),
    costSource,
  };
}

export function toGroup({
  row,
  groupBy,
  trend,
  titles,
}: {
  row: RawGroupRow;
  groupBy: ResultsGroupBy;
  trend: TrendPoint[];
  titles: GroupTitles;
}): ResultGroup {
  const atoms = Number(row.Atoms);
  const { key, title, subtitle } = headline({ row, groupBy, titles });

  return {
    key,
    title,
    subtitle,
    passRate: rate(Number(row.Passed), Number(row.Settled)),
    runCount: Number(row.RunCount),
    scenarioCount: Number(row.ScenarioCount),
    lastRunAt: row.LastRunAt === "0" ? null : Number(row.LastRunAt),
    targetKeys: row.TargetKeys,
    // Only a target group names one target. Any other grouping folds runs of
    // several targets, and the overrides of one of them would name the group
    // after a target it does not stand for.
    targetParameters: groupBy === "target" ? targetParametersOf(row.TargetParameters) : null,
    trend,
    cost: toCost({ totalUsd: Number(row.CostTotal), atoms, unknown: Number(row.CostUnknown) }),
  };
}

/**
 * The name a group reads under when the project holds no scenario for it: a
 * scenario that ran from code has no row to read, so it reads under the name
 * its runs carried, and under its key when they carried none.
 */
export function carriedName(row: RawGroupRow): string {
  return row.Name !== "" ? row.Name : row.GroupKey;
}

/**
 * The name a target group reads under: the agent name the code that pushed
 * the runs reported, and the key itself when it reported none. A platform
 * target reports none, and the client names it from its own target map.
 */
export function carriedTargetName(row: RawGroupRow): string {
  return row.TargetName !== "" ? row.TargetName : row.GroupKey;
}

export function headline({
  row,
  groupBy,
  titles,
}: {
  row: RawGroupRow;
  groupBy: ResultsGroupBy;
  titles: GroupTitles;
}): { key: string; title: string; subtitle: string | null } {
  if (groupBy === "scenario" && titles.kind === "scenario") {
    const found = titles.byId.get(row.GroupKey);

    return {
      key: row.GroupKey,
      title: found?.title ?? carriedName(row),
      subtitle: found?.subtitle === "" ? null : (found?.subtitle ?? null),
    };
  }

  if (groupBy === "plan" && "plans" in titles) {
    const plan = planFor(row.GroupKey, titles.plans.bySetId);

    return { key: plan.slug, title: plan.name, subtitle: null };
  }

  if (groupBy === "none" && "plans" in titles) {
    // A group of one execution reads under the plan that ran it.
    return { key: row.GroupKey, title: row.GroupKey, subtitle: null };
  }

  // Target: a run from code reads under the agent name it reported, and the
  // client names a platform reference id through its own target map.
  return { key: row.GroupKey, title: carriedTargetName(row), subtitle: null };
}

/**
 * A pass rate as a percentage, or null when nothing settled. Null and zero
 * are different colours: a run still in flight is not a run that failed,
 * and coercing one to the other paints an unfinished plan red.
 */
export function rate(passed: number, settled: number): number | null {
  if (settled <= 0) {
    return null;
  }

  return (passed / settled) * 100;
}

export function toCost({
  totalUsd,
  atoms,
  unknown,
}: {
  totalUsd: number;
  atoms: number;
  unknown: number;
}): AtomCost {
  return { totalUsd, knownAtoms: atoms - unknown, unknownAtoms: unknown };
}

/**
 * Sparkline points per group, oldest first, capped. When a group holds
 * more than the cap, the MOST RECENT points are kept: a sparkline is read
 * to see where a plan is heading, so the distant past is what can be dropped.
 */
export function foldTrend({
  rows,
  maxPoints,
}: {
  rows: RawTrendRow[];
  maxPoints: number;
}): Map<string, TrendPoint[]> {
  const byGroup = new Map<string, RawTrendRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.GroupKey);
    if (list) {
      list.push(row);
    } else {
      byGroup.set(row.GroupKey, [row]);
    }
  }

  const folded = new Map<string, TrendPoint[]>();
  for (const [groupKey, list] of byGroup) {
    const sorted = [...list].sort(
      (a, b) => Number(a.RunAt) - Number(b.RunAt) || a.TrendKey.localeCompare(b.TrendKey),
    );
    const kept = sorted.slice(-maxPoints);
    folded.set(
      groupKey,
      kept.map((row) => ({
        key: row.TrendKey,
        passRate: rate(Number(row.Passed), Number(row.Settled)),
      })),
    );
  }

  return folded;
}

/**
 * Every bucket in the window, including the ones nothing ran in. A missing
 * bucket is returned as empty rather than dropped, so the chart draws a
 * gap — a zero-height bar would read as total failure, the opposite of what an empty bucket means.
 */
export function fillSeries({
  rows,
  startDate,
  endDate,
  bucketSeconds,
  labelFor,
}: {
  rows: { Bucket: string; Passed: string; Settled: string }[];
  startDate: number;
  endDate: number;
  bucketSeconds: number;
  labelFor: (at: number) => string;
}): SeriesBucket[] {
  const width = bucketSeconds * 1000;
  const byBucket = new Map(rows.map((row) => [Number(row.Bucket), row]));
  const first = Math.floor(startDate / width) * width;
  const buckets: SeriesBucket[] = [];

  for (let at = first; at <= endDate; at += width) {
    const found = byBucket.get(at);
    const settled = found ? Number(found.Settled) : 0;
    buckets.push({
      label: labelFor(at),
      passRate: found ? rate(Number(found.Passed), settled) : null,
      isEmpty: !found,
    });
  }

  return buckets;
}

/**
 * Adds the plans that did not run in the window, so none of them vanishes
 * — they read as nothing in the period (no runs, no scenarios, no pass
 * rate, empty trend). Dropping them would hide exactly the plan a worried person came to check on.
 */
export function withQuietPlans({
  groups,
  plans,
}: {
  groups: ResultGroup[];
  plans: PlanIndex;
}): ResultGroup[] {
  const seen = new Set(groups.map((group) => group.key));
  const quiet: ResultGroup[] = [];
  for (const plan of plans.all) {
    if (seen.has(plan.slug)) {
      continue;
    }

    quiet.push({
      key: plan.slug,
      title: plan.name,
      subtitle: null,
      passRate: null,
      runCount: 0,
      scenarioCount: 0,
      lastRunAt: null,
      targetKeys: [],
      targetParameters: null,
      trend: [],
      cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
    });
  }

  return [...groups, ...quiet];
}
