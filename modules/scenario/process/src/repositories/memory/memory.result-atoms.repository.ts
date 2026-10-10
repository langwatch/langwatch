import { Buffer } from "node:buffer";

import {
  AGENT_TEST_SET_SUFFIX,
  MAX_ATOM_PAGE,
  MAX_TREND_POINTS,
  UNKNOWN_TARGET_KEY,
  VOICE_CALL_SCENARIO_SET_ID,
  expandSetIdFilter,
  type AtomOutcome,
  type ResultsFilter,
  type ResultsGroupBy,
} from "@langwatch/scenario-contract";

import type {
  SimulationRunState,
  SimulationRunStateData,
} from "../../eventing/simulation-run-state.projection.ts";
import {
  jsonArray,
  jsonRaw,
  jsonString,
  parseRunMetadata,
} from "../../rules/run-metadata.rules.ts";
import { evaluationsToColumns } from "../../rules/simulation-evaluation-columns.rules.ts";
import {
  FAILED_STATUS_VALUES,
  MAX_CODE_SCENARIOS,
  MAX_RUN_TARGETS,
  PASSED_STATUS_VALUES,
} from "../clickhouse/clickhouse.result-atoms.repository.ts";
import { mapStatus } from "../clickhouse/simulation-run.mapper.ts";
import {
  type RawAtomRow,
  type RawCodeScenarioRow,
  type RawGroupRow,
  type RawRunTargetRow,
  type RawSeriesRow,
  type RawTotalsRow,
  type RawTrendRow,
  type RunOrdinalRow,
  ResultAtomsRepository,
} from "../result-atoms.repository.ts";
import type { MemorySimulationRunStateRepository } from "./memory.simulation-run-state.repository.ts";

const PASSED_STATUSES = new Set<string>(PASSED_STATUS_VALUES);
const FAILED_STATUSES = new Set<string>(FAILED_STATUS_VALUES);

/** One run in scope, with every value the live SQL derives from its row read once. */
export interface ScopedAtom {
  state: SimulationRunStateData;
  scenarioRunId: string;
  /** The parsed metadata, `{}` when the run carries none, as `ifNull(Metadata, '{}')` reads it. */
  metadata: unknown;
  /** `ifNull(StartedAt, CreatedAt)`: the one key every read windows, orders and pages by. */
  runAt: number;
  outcome: AtomOutcome;
  targetReferenceId: string;
  targetKey: string;
  targetParameters: string;
  targetName: string;
  trigger: "app" | "code";
  scenarioKey: string;
  costSource: "run" | "traces" | "none" | "unknown";
  costUsd: string;
  costNumeric: number;
}

/** A group is never empty: it exists because an atom was folded into it. */
type NonEmpty<T> = [T, ...T[]];

interface AtomCursor {
  ts: string;
  executionId: string;
}

interface Tally {
  Atoms: string;
  Passed: string;
  Settled: string;
  RunCount: string;
  CostTotal: string;
  CostUnknown: string;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Any name as a key, the way the live `nameSlug` folds it: "List agents" is "list-agents". */
function nameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** The agent names the run reported, joined; the simulator and the judge are not targets. */
function codeTargetName(metadata: unknown): string {
  return jsonArray({ value: metadata, path: ["agents"] })
    .filter((agent) => jsonString({ value: agent, path: ["role"] }) === "agent")
    .map((agent) => jsonString({ value: agent, path: ["name"] }))
    .filter((name) => name !== "")
    .join(" vs ");
}

function outcomeOf(status: string): AtomOutcome {
  if (PASSED_STATUSES.has(status)) return "passed";
  return FAILED_STATUSES.has(status) ? "failed" : "pending";
}

/** The run's cost and where it came from, in the live `COST_SOURCE_EXPR` order. */
function costOf(
  state: SimulationRunStateData,
): Pick<ScopedAtom, "costSource" | "costUsd" | "costNumeric"> {
  if (state.TotalCost != null) {
    return { costSource: "run", costUsd: String(state.TotalCost), costNumeric: state.TotalCost };
  }
  const traces = Object.values(state.TraceMetrics);
  if (traces.length > 0) {
    const summed = traces.reduce((total, trace) => total + trace.totalCost, 0);
    return { costSource: "traces", costUsd: String(summed), costNumeric: summed };
  }
  if (state.TraceIds.length === 0) return { costSource: "none", costUsd: "0", costNumeric: 0 };
  return { costSource: "unknown", costUsd: "", costNumeric: 0 };
}

function toScopedAtom(projection: SimulationRunState): ScopedAtom {
  const state = projection.data;
  const metadata = parseRunMetadata(state.Metadata);
  const targetReferenceId = jsonString({
    value: metadata,
    path: ["langwatch", "targetReferenceId"],
  });
  const stampedKey = jsonString({ value: metadata, path: ["langwatch", "targetKey"] });
  const targetName = codeTargetName(metadata);
  const targetSlug = nameSlug(targetName);
  const nameKey = nameSlug(state.Name ?? "");
  const setKey = state.ScenarioSetId === "" ? "default" : state.ScenarioSetId;
  return {
    state,
    scenarioRunId: projection.aggregateId || state.ScenarioRunId,
    metadata,
    runAt: state.StartedAt ?? state.CreatedAt,
    outcome: outcomeOf(state.Status),
    targetReferenceId,
    targetKey:
      stampedKey || targetReferenceId || (targetSlug ? `code:${targetSlug}` : UNKNOWN_TARGET_KEY),
    targetParameters: jsonRaw({ value: metadata, path: ["langwatch", "targetParameters"] }),
    targetName,
    trigger: targetReferenceId === "" ? "code" : "app",
    scenarioKey:
      targetReferenceId === "" && nameKey !== "" ? `${setKey}-${nameKey}` : state.ScenarioId,
    ...costOf(state),
  };
}

/** The live `stableFilterParts`: a row that names a scenario, outside the agent-test sets. */
function inStableScope({
  atom,
  setIds,
}: {
  atom: ScopedAtom;
  setIds: ReadonlySet<string> | null;
}): boolean {
  const { ScenarioId, ScenarioSetId } = atom.state;
  if (ScenarioId === "") return false;
  if (ScenarioSetId.endsWith(AGENT_TEST_SET_SUFFIX)) return false;
  if (ScenarioSetId === VOICE_CALL_SCENARIO_SET_ID) return false;
  return setIds === null || setIds.has(ScenarioSetId);
}

/** The live `volatileFilterParts`, read off the latest fold. An empty list narrows nothing. */
function inVolatileScope({ atom, filter }: { atom: ScopedAtom; filter: ResultsFilter }): boolean {
  if (atom.runAt < filter.startDate) return false;
  if (filter.endDate !== undefined && atom.runAt > filter.endDate) return false;
  if (filter.outcome !== undefined && atom.outcome !== filter.outcome) return false;
  if (filter.targetKeys?.length && !filter.targetKeys.includes(atom.targetKey)) return false;
  return !filter.scenarioIds?.length || filter.scenarioIds.includes(atom.scenarioKey);
}

/** An empty requested list means "none of them", so the atom reads answer nothing. */
function isEmptyScope(filter: ResultsFilter): boolean {
  return (
    filter.scenarioIds?.length === 0 ||
    filter.scenarioSetIds?.length === 0 ||
    filter.targetKeys?.length === 0
  );
}

function newestFirst(left: ScopedAtom, right: ScopedAtom): number {
  return right.runAt - left.runAt || compareText(right.scenarioRunId, left.scenarioRunId);
}

/** The atom `argMax(…, RunAt)` picks: on a tie (left open live) the higher run id. */
function newestOf(atoms: NonEmpty<ScopedAtom>): ScopedAtom {
  return atoms.reduce((newest, atom) => (newestFirst(atom, newest) < 0 ? atom : newest));
}

function groupAtoms({
  atoms,
  keyOf,
}: {
  atoms: readonly ScopedAtom[];
  keyOf: (atom: ScopedAtom) => string;
}): [string, NonEmpty<ScopedAtom>][] {
  const groups = new Map<string, NonEmpty<ScopedAtom>>();
  for (const atom of atoms) {
    const key = keyOf(atom);
    const group = groups.get(key);
    if (group) group.push(atom);
    else groups.set(key, [atom]);
  }
  return [...groups.entries()].toSorted(([left], [right]) => compareText(left, right));
}

function groupKeyOf(groupBy: ResultsGroupBy): (atom: ScopedAtom) => string {
  switch (groupBy) {
    case "plan":
      return (atom) => atom.state.ScenarioSetId;
    case "scenario":
      return (atom) => atom.scenarioKey;
    case "target":
      return (atom) => atom.targetKey;
    case "none":
      return (atom) => atom.scenarioRunId;
  }
}

/** The counts every aggregate reads, as the strings ClickHouse serialises them to. */
function tally(atoms: readonly ScopedAtom[]): Tally {
  return {
    Atoms: String(atoms.length),
    Passed: String(atoms.filter((atom) => atom.outcome === "passed").length),
    Settled: String(atoms.filter((atom) => atom.outcome !== "pending").length),
    RunCount: String(new Set(atoms.map((atom) => atom.state.BatchRunId)).size),
    CostTotal: String(atoms.reduce((total, atom) => total + atom.costNumeric, 0)),
    CostUnknown: String(atoms.filter((atom) => atom.costSource === "unknown").length),
  };
}

function toAtomRow(atom: ScopedAtom): RawAtomRow {
  const { state } = atom;
  const evaluations = evaluationsToColumns(state.Evaluations);
  return {
    SetId: state.ScenarioSetId,
    BatchRunId: state.BatchRunId,
    ScenarioRunId: atom.scenarioRunId,
    ScenarioId: state.ScenarioId,
    ScenarioKey: atom.scenarioKey,
    ScenarioName: state.Name ?? "",
    Status: mapStatus(state.Status),
    Outcome: atom.outcome,
    RunAt: String(atom.runAt),
    DurationMs: state.DurationMs == null ? "" : String(state.DurationMs),
    Note: jsonString({ value: atom.metadata, path: ["note"] }),
    TargetKey: atom.targetKey,
    TargetParameters: atom.targetParameters,
    TargetName: atom.targetName,
    Trigger: atom.trigger,
    CostUsd: atom.costUsd,
    CostSource: atom.costSource,
    SortKey: String(atom.runAt),
    EvaluationIds: evaluations["Evaluations.EvaluatorId"],
    EvaluationNames: evaluations["Evaluations.Name"],
    EvaluationStatuses: evaluations["Evaluations.Status"],
    EvaluationRequired: evaluations["Evaluations.Required"],
    EvaluationPassed: evaluations["Evaluations.Passed"],
    EvaluationScores: evaluations["Evaluations.Score"],
    EvaluationLabels: evaluations["Evaluations.Label"],
  };
}

function encodeCursor(cursor: AtomCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): AtomCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const ts = jsonString({ value: parsed, path: ["ts"] });
    const executionId = jsonString({ value: parsed, path: ["executionId"] });
    return ts && executionId ? { ts, executionId } : null;
  } catch {
    return null;
  }
}

/** The Results tab reads over the memory run fold, ported from the live atom SQL read for read. */
export class MemoryResultAtomsRepository extends ResultAtomsRepository {
  static create({
    runs,
  }: {
    runs: MemorySimulationRunStateRepository<SimulationRunState>;
  }): MemoryResultAtomsRepository {
    return new MemoryResultAtomsRepository(runs);
  }

  /** The live `atomScopeSql`: the project's latest unarchived folds the filter keeps. */
  static atomsInScope({
    runs,
    filter,
  }: {
    runs: MemorySimulationRunStateRepository<SimulationRunState>;
    filter: ResultsFilter;
  }): ScopedAtom[] {
    const setIds = filter.scenarioSetIds?.length
      ? new Set(filter.scenarioSetIds.flatMap((setId) => expandSetIdFilter(setId)))
      : null;
    return runs
      .findForTenants({ tenantIds: [filter.projectId] })
      .filter((projection) => projection.data.ArchivedAt == null)
      .map(toScopedAtom)
      .filter((atom) => inStableScope({ atom, setIds }) && inVolatileScope({ atom, filter }));
  }

  private constructor(
    private readonly runs: MemorySimulationRunStateRepository<SimulationRunState>,
  ) {
    super();
  }

  private scope(filter: ResultsFilter): ScopedAtom[] {
    return MemoryResultAtomsRepository.atomsInScope({ runs: this.runs, filter });
  }

  async listAtoms({
    filter,
    limit,
    cursor,
  }: {
    filter: ResultsFilter;
    limit: number;
    cursor?: string;
  }): Promise<{ atoms: RawAtomRow[]; nextCursor?: string; hasMore: boolean }> {
    if (isEmptyScope(filter)) return { atoms: [], hasMore: false };
    const pageSize = Math.min(Math.max(1, limit), MAX_ATOM_PAGE);
    const decoded = cursor ? decodeCursor(cursor) : null;
    const cursorAt = decoded ? Number(decoded.ts) : 0;
    const remaining = this.scope(filter)
      .toSorted(newestFirst)
      .filter(
        (atom) =>
          !decoded ||
          atom.runAt < cursorAt ||
          (atom.runAt === cursorAt && atom.scenarioRunId < decoded.executionId),
      );
    const hasMore = remaining.length > pageSize;
    const atoms = remaining.slice(0, pageSize).map(toAtomRow);
    const last = atoms.at(-1);
    return {
      atoms,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ ts: last.SortKey, executionId: last.ScenarioRunId })
          : undefined,
    };
  }

  async findRunOrdinals(filter: ResultsFilter): Promise<RunOrdinalRow[]> {
    if (isEmptyScope(filter)) return [];
    const batches = groupAtoms({
      atoms: this.scope(filter),
      keyOf: (atom) => JSON.stringify([atom.state.ScenarioSetId, atom.state.BatchRunId]),
    }).map(([, atoms]) => ({
      setId: atoms[0].state.ScenarioSetId,
      batchRunId: atoms[0].state.BatchRunId,
      runAt: Math.min(...atoms.map((atom) => atom.runAt)),
    }));
    const bySet = new Map<string, typeof batches>();
    for (const batch of batches) bySet.set(batch.setId, [...(bySet.get(batch.setId) ?? []), batch]);
    return [...bySet.values()].flatMap((runs) =>
      runs
        .toSorted(
          (left, right) =>
            left.runAt - right.runAt || compareText(left.batchRunId, right.batchRunId),
        )
        .map((run, index) => ({
          SetId: run.setId,
          BatchRunId: run.batchRunId,
          RunAt: String(run.runAt),
          Ordinal: String(index + 1),
        })),
    );
  }

  async aggregateTotals(filter: ResultsFilter): Promise<RawTotalsRow> {
    const atoms = isEmptyScope(filter) ? [] : this.scope(filter);
    const failing = atoms.filter((atom) => atom.outcome === "failed");
    return {
      ...tally(atoms),
      FailingScenarios: String(new Set(failing.map((atom) => atom.state.ScenarioId)).size),
    };
  }

  // An arrow instance property, not a prototype method: the abstract base declares it as a
  // property member, and a class member's kind must match its base across `extends`.
  aggregateGroups = async ({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawGroupRow[]> => {
    if (isEmptyScope(filter)) return [];
    return groupAtoms({ atoms: this.scope(filter), keyOf: groupKeyOf(groupBy) }).map(
      ([groupKey, atoms]) => {
        const newest = newestOf(atoms);
        return {
          GroupKey: groupKey,
          Name: newest.state.Name ?? "",
          TargetName: newest.targetName,
          TargetParameters: newest.targetParameters,
          ...tally(atoms),
          ScenarioCount: String(new Set(atoms.map((atom) => atom.state.ScenarioId)).size),
          LastRunAt: String(newest.runAt),
          TargetKeys: [...new Set(atoms.map((atom) => atom.targetKey))].toSorted(compareText),
        };
      },
    );
  };

  async findCodeScenarios(filter: ResultsFilter): Promise<RawCodeScenarioRow[]> {
    if (isEmptyScope(filter)) return [];
    const fromCode = this.scope(filter).filter((atom) => atom.trigger === "code");
    return groupAtoms({ atoms: fromCode, keyOf: (atom) => atom.scenarioKey })
      .map(([scenarioKey, atoms]) => ({
        ScenarioKey: scenarioKey,
        Name: newestOf(atoms).state.Name ?? "",
      }))
      .toSorted(
        (left, right) =>
          compareText(left.Name, right.Name) || compareText(left.ScenarioKey, right.ScenarioKey),
      )
      .slice(0, MAX_CODE_SCENARIOS);
  }

  async findRunTargets(filter: ResultsFilter): Promise<RawRunTargetRow[]> {
    if (isEmptyScope(filter)) return [];
    const unlisted = this.scope(filter).filter(
      (atom) =>
        (atom.trigger === "code" && atom.targetKey !== UNKNOWN_TARGET_KEY) ||
        atom.targetParameters !== "",
    );
    return groupAtoms({ atoms: unlisted, keyOf: (atom) => atom.targetKey })
      .map(([targetKey, atoms]) => {
        const newest = newestOf(atoms);
        return {
          TargetKey: targetKey,
          Name: newest.targetName,
          ReferenceId: newest.targetReferenceId,
          TargetParameters: newest.targetParameters,
        };
      })
      .toSorted(
        (left, right) =>
          compareText(left.Name, right.Name) ||
          compareText(left.ReferenceId, right.ReferenceId) ||
          compareText(left.TargetKey, right.TargetKey),
      )
      .slice(0, MAX_RUN_TARGETS);
  }

  async aggregateTrend({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawTrendRow[]> {
    if (isEmptyScope(filter)) return [];
    const trendKeyOf = (atom: ScopedAtom): string =>
      groupBy === "plan" ? atom.state.BatchRunId : atom.scenarioRunId;
    return groupAtoms({ atoms: this.scope(filter), keyOf: groupKeyOf(groupBy) }).flatMap(
      ([groupKey, atoms]) =>
        groupAtoms({ atoms, keyOf: trendKeyOf })
          .map(([trendKey, bar]) => ({
            trendKey,
            runAt: Math.min(...bar.map((atom) => atom.runAt)),
            counts: tally(bar),
          }))
          .toSorted(
            (left, right) => right.runAt - left.runAt || compareText(right.trendKey, left.trendKey),
          )
          .slice(0, MAX_TREND_POINTS)
          .map((point) => ({
            GroupKey: groupKey,
            TrendKey: point.trendKey,
            RunAt: String(point.runAt),
            Passed: point.counts.Passed,
            Settled: point.counts.Settled,
          })),
    );
  }

  async aggregateSeries({
    filter,
    bucketSeconds,
  }: {
    filter: ResultsFilter;
    bucketSeconds: number;
  }): Promise<RawSeriesRow[]> {
    if (isEmptyScope(filter)) return [];
    const bucketMs = bucketSeconds * 1000;
    return groupAtoms({
      atoms: this.scope(filter),
      keyOf: (atom) => String(Math.floor(atom.runAt / bucketMs) * bucketMs),
    })
      .map(([bucket, atoms]) => ({ bucket: Number(bucket), counts: tally(atoms) }))
      .toSorted((left, right) => left.bucket - right.bucket)
      .map(({ bucket, counts }) => ({
        Bucket: String(bucket),
        Passed: counts.Passed,
        Settled: counts.Settled,
      }));
  }
}
