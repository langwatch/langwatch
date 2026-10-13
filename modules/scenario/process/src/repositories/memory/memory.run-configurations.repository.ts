import { MAX_RUN_CONFIGURATIONS, type ResultsFilter } from "@langwatch/scenario-contract";

import type { SimulationRunState } from "../../eventing/simulation-run-state.projection.ts";
import { jsonRaw, jsonString } from "../../rules/run-metadata.rules.ts";
import {
  type RawRunConfigurationRow,
  RunConfigurationsRepository,
} from "../run-configurations.repository.ts";
import { MemoryResultAtomsRepository, type ScopedAtom } from "./memory.result-atoms.repository.ts";
import type { MemorySimulationRunStateRepository } from "./memory.simulation-run-state.repository.ts";

/** A group is never empty: it exists because a row was folded into it. */
type NonEmpty<T> = [T, ...T[]];

function isNonEmpty<T>(items: T[]): items is NonEmpty<T> {
  return items.length > 0;
}

/** One target of one scenario inside one run plan execution: the live innermost GROUP BY. */
interface PairFold {
  setId: string;
  batchRunId: string;
  targetPair: string;
  targetParameters: string;
  runs: number;
  simulatorModel: string;
  judgeModel: string;
  parameters: string;
  hasNote: boolean;
  firstRunId: string;
  runAt: number;
}

/** One run plan execution, as the configuration it was asked to run. */
interface BatchFold {
  setId: string;
  targets: [pair: string, parameters: string][];
  repeatCount: number;
  simulatorModel: string;
  judgeModel: string;
  parameters: string;
  firstTargetParameters: string;
  hasNote: boolean;
  runAt: number;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function maxText(values: readonly string[]): string {
  return values.reduce((highest, value) => (compareText(value, highest) > 0 ? value : highest), "");
}

function groupBy<T>({
  items,
  keyOf,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
}): NonEmpty<T>[] {
  const groups = new Map<string, NonEmpty<T>>();
  for (const item of items) {
    const group = groups.get(keyOf(item));
    if (group) group.push(item);
    else groups.set(keyOf(item), [item]);
  }
  return [...groups.values()];
}

/** The live `TARGET_PAIR_EXPR`: `<type>:<targetKey>`. */
function targetPairOf(atom: ScopedAtom): string {
  return `${jsonString({ value: atom.metadata, path: ["langwatch", "targetType"] })}:${atom.targetKey}`;
}

/** `argMin(…, FirstRunId)`: the pair whose first scenario run has the lowest id. */
function earliestPair(pairs: NonEmpty<PairFold>): PairFold {
  return pairs.reduce((earliest, pair) =>
    compareText(pair.firstRunId, earliest.firstRunId) < 0 ? pair : earliest,
  );
}

/** The pair of one scenario against one target; `any()` takes the lowest run id's values. */
function foldPair(atoms: NonEmpty<ScopedAtom>): PairFold {
  const lead = atoms.reduce((lowest, atom) =>
    compareText(atom.scenarioRunId, lowest.scenarioRunId) < 0 ? atom : lowest,
  );
  const langwatch = (key: string): string[] =>
    atoms.map((atom) => jsonString({ value: atom.metadata, path: ["langwatch", key] }));
  return {
    setId: lead.state.ScenarioSetId,
    batchRunId: lead.state.BatchRunId,
    targetPair: targetPairOf(lead),
    targetParameters: lead.targetParameters,
    runs: atoms.length,
    simulatorModel: maxText(langwatch("simulatorModel")),
    judgeModel: maxText(langwatch("judgeModel")),
    parameters: jsonRaw({ value: lead.metadata, path: ["parameters"] }),
    hasNote: atoms.some((atom) => jsonString({ value: atom.metadata, path: ["note"] }) !== ""),
    firstRunId: lead.scenarioRunId,
    runAt: Math.max(...atoms.map((atom) => atom.runAt)),
  };
}

/** A run plan execution; its parameters come from a target with no overrides when one ran. */
function foldBatch(pairs: NonEmpty<PairFold>): BatchFold {
  const plain = pairs.filter((pair) => pair.targetParameters === "");
  const source = isNonEmpty(plain) ? earliestPair(plain) : earliestPair(pairs);
  const targets = new Map(
    pairs.map((pair): [string, [string, string]] => [
      JSON.stringify([pair.targetPair, pair.targetParameters]),
      [pair.targetPair, pair.targetParameters],
    ]),
  );
  return {
    setId: pairs[0].setId,
    targets: [...targets.values()].toSorted(
      ([leftPair, leftParameters], [rightPair, rightParameters]) =>
        compareText(leftPair, rightPair) || compareText(leftParameters, rightParameters),
    ),
    repeatCount: Math.max(...pairs.map((pair) => pair.runs)),
    simulatorModel: maxText(pairs.map((pair) => pair.simulatorModel)),
    judgeModel: maxText(pairs.map((pair) => pair.judgeModel)),
    parameters: source.parameters,
    firstTargetParameters: isNonEmpty(plain) ? "" : source.targetParameters,
    hasNote: pairs.some((pair) => pair.hasNote),
    runAt: Math.max(...pairs.map((pair) => pair.runAt)),
  };
}

/** The run dialog's configuration history over the memory run fold, ported from the live SQL. */
export class MemoryRunConfigurationsRepository extends RunConfigurationsRepository {
  static create({
    runs,
  }: {
    runs: MemorySimulationRunStateRepository<SimulationRunState>;
  }): MemoryRunConfigurationsRepository {
    return new MemoryRunConfigurationsRepository(runs);
  }

  private constructor(
    private readonly runs: MemorySimulationRunStateRepository<SimulationRunState>,
  ) {
    super();
  }

  async findConfigurations({
    filter,
    limit = MAX_RUN_CONFIGURATIONS,
  }: {
    filter: ResultsFilter;
    limit?: number;
  }): Promise<RawRunConfigurationRow[]> {
    // An empty set list means "none of them", as the live read short-circuits it.
    if (filter.scenarioSetIds?.length === 0) return [];
    // Only a run the platform pointed at a target can be offered back as a configuration.
    const targeted = MemoryResultAtomsRepository.atomsInScope({ runs: this.runs, filter }).filter(
      (atom) => atom.targetReferenceId !== "",
    );
    const pairs = groupBy({
      items: targeted,
      keyOf: (atom) =>
        JSON.stringify([
          atom.state.ScenarioSetId,
          atom.state.BatchRunId,
          atom.state.ScenarioId,
          targetPairOf(atom),
        ]),
    }).map(foldPair);
    const batches = groupBy({
      items: pairs,
      keyOf: (pair) => JSON.stringify([pair.setId, pair.batchRunId]),
    }).map(foldBatch);
    const configurations = groupBy({
      items: batches,
      keyOf: (batch) =>
        JSON.stringify([
          batch.setId,
          batch.targets,
          batch.repeatCount,
          batch.simulatorModel,
          batch.judgeModel,
          batch.parameters,
          batch.firstTargetParameters,
        ]),
    }).map((runsOfOne): RawRunConfigurationRow & { lastRunAt: number } => {
      const lastRunAt = Math.max(...runsOfOne.map((batch) => batch.runAt));
      const [first] = runsOfOne;
      return {
        SetId: first.setId,
        TargetPairs: first.targets.map(([pair]) => pair),
        TargetParameters: first.targets.map(([, parameters]) => parameters),
        RepeatCount: String(first.repeatCount),
        SimulatorModel: first.simulatorModel,
        JudgeModel: first.judgeModel,
        Parameters: first.parameters,
        FirstTargetParameters: first.firstTargetParameters,
        UsesNote: runsOfOne.some((batch) => batch.hasNote) ? "1" : "0",
        LastRunAtMs: String(lastRunAt),
        lastRunAt,
      };
    });
    const pageSize = Math.min(Math.max(1, limit), MAX_RUN_CONFIGURATIONS);
    return configurations
      .toSorted((left, right) => right.lastRunAt - left.lastRunAt)
      .slice(0, pageSize)
      .map(({ lastRunAt: _lastRunAt, ...row }) => row);
  }
}
