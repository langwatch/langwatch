/**
 * The expressions that read a configuration off a run row, and the repository that reads the
 * configurations a project's plans already ran with.
 * @see specs/features/agent-testing/run-configuration-history.feature
 */
import {
  clickhouseRead,
  fn,
  param,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";
import { MAX_RUN_CONFIGURATIONS, type ResultsFilter } from "@langwatch/scenario-contract";

import {
  type RawRunConfigurationRow,
  RunConfigurationsRepository,
} from "../run-configurations.repository.ts";
import {
  atomFields,
  ResultAtomsClickHouseRepository,
  type ResultAtomsClickHouseClientResolver,
} from "./clickhouse.result-atoms.repository.ts";
import { simulationRuns } from "./clickhouse.simulation-runs.table.ts";

/** A configuration row as the builder returns it: its arrays read-only until copied. */
type RunConfigurationReadRow = Omit<RawRunConfigurationRow, "TargetPairs" | "TargetParameters"> & {
  TargetPairs: readonly string[];
  TargetParameters: readonly string[];
};

/**
 * Reads the configurations a project's plans already ran with, over ClickHouse.
 */
export class RunConfigurationsClickHouseRepository extends RunConfigurationsRepository {
  static create(
    resolveClient: ResultAtomsClickHouseClientResolver,
  ): RunConfigurationsClickHouseRepository {
    return new RunConfigurationsClickHouseRepository(resolveClient);
  }

  private constructor(private readonly resolveClient: ResultAtomsClickHouseClientResolver) {
    super();
  }

  private async getClient(tenantId: string): ReturnType<ResultAtomsClickHouseClientResolver> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }

    return this.resolveClient(tenantId);
  }

  /**
   * One row per distinct configuration, newest first.
   */
  async findConfigurations({
    filter,
    limit = MAX_RUN_CONFIGURATIONS,
  }: {
    filter: ResultsFilter;
    limit?: number;
  }): Promise<RawRunConfigurationRow[]> {
    // An empty set list means "none of them". Sending no filter at all would
    // read the whole project instead, which is the opposite answer.
    if (filter.scenarioSetIds?.length === 0) return [];

    const client = await this.getClient(filter.projectId);
    const { rows } = await client.read({
      statement: RunConfigurationsClickHouseRepository.configurationsRead({ filter, limit }),
      table: simulationRuns.$table.name,
    });

    return rows.map((row) => ({
      ...row,
      TargetPairs: [...row.TargetPairs],
      TargetParameters: [...row.TargetParameters],
    }));
  }

  /**
   * Runs collapse to one row per scenario and target of a batch, then to one per batch, then to
   * one per distinct configuration. Only runs the platform pointed at a target count: an SDK or
   * CI run carries none, so the dialog has nothing to offer back for it.
   */
  static configurationsRead({
    filter,
    limit = MAX_RUN_CONFIGURATIONS,
  }: {
    filter: ResultsFilter;
    limit?: number;
  }): ReaderReadStatement<RunConfigurationReadRow> {
    const { scope, atoms } = ResultAtomsClickHouseRepository.atomScope(filter);
    const runs = clickhouseRead({ scope })
      .from(atoms)
      .select((ops) => ({
        SetId: atoms.ScenarioSetId,
        BatchRunId: atoms.BatchRunId,
        ScenarioId: atoms.ScenarioId,
        ScenarioRunId: atoms.ScenarioRunId,
        // `<type>:<targetKey>`, the fields the shared key recipe joins, in its order.
        TargetPair: fn.concat(
          atomFields.langwatchString(atoms, "targetType"),
          ":",
          atomFields.targetKey(atoms, ops),
        ),
        TargetParameters: atomFields.targetParameters(atoms),
        // '' when the plan named none, which keys the same way as a run before the stamp.
        SimulatorModel: atomFields.langwatchString(atoms, "simulatorModel"),
        JudgeModel: atomFields.langwatchString(atoms, "judgeModel"),
        // Raw, since re-typing strings, numbers and booleans in SQL would lose which they were.
        Parameters: atomFields.metadataRaw(atoms, "parameters"),
        // Whether the run carried a note; the text belongs to one run and is never carried over.
        HasNote: ops.ne(atomFields.metadataString(atoms, "note"), ""),
        RunAt: atomFields.sortKey(atoms),
      }))
      .where((ops) =>
        ops.and(
          ResultAtomsClickHouseRepository.inScope(filter, atoms, ops),
          ops.ne(atomFields.targetRef(atoms), ""),
        ),
      )
      .as("target_runs");
    const pairs = clickhouseRead({ scope })
      .from(runs)
      .select({
        SetId: runs.SetId,
        BatchRunId: runs.BatchRunId,
        TargetPair: runs.TargetPair,
        TargetParameters: fn.any(runs.TargetParameters),
        PairRuns: fn.count(),
        SimulatorModel: fn.max(runs.SimulatorModel),
        JudgeModel: fn.max(runs.JudgeModel),
        Parameters: fn.any(runs.Parameters),
        HasNote: fn.max(runs.HasNote),
        FirstRunId: fn.min(runs.ScenarioRunId),
        PairRunAt: fn.max(runs.RunAt),
      })
      .groupBy(runs.SetId, runs.BatchRunId, runs.ScenarioId, runs.TargetPair)
      .as("target_pairs");
    const batches = clickhouseRead({ scope })
      .from(pairs)
      .select(({ eq, gt }) => {
        const untargeted = eq(pairs.TargetParameters, "");
        const anyUntargeted = gt(fn.countIf(untargeted), 0);
        return {
          SetId: pairs.SetId,
          Targets: fn.arraySort(
            fn.groupUniqArray(fn.tuple(pairs.TargetPair, pairs.TargetParameters)),
          ),
          RepeatCount: fn.max(pairs.PairRuns),
          SimulatorModel: fn.max(pairs.SimulatorModel),
          JudgeModel: fn.max(pairs.JudgeModel),
          Parameters: fn.if(
            anyUntargeted,
            fn.argMinIf(pairs.Parameters, pairs.FirstRunId, untargeted),
            fn.argMin(pairs.Parameters, pairs.FirstRunId),
          ),
          FirstTargetParameters: fn.if(
            anyUntargeted,
            param.string(""),
            fn.argMin(pairs.TargetParameters, pairs.FirstRunId),
          ),
          HasNote: fn.max(pairs.HasNote),
          BatchRunAt: fn.max(pairs.PairRunAt),
        };
      })
      .groupBy(pairs.SetId, pairs.BatchRunId)
      .as("batch_configurations");
    return clickhouseRead({ scope })
      .from(batches)
      .select({
        SetId: batches.SetId,
        TargetPairs: fn.arrayMap((target) => fn.tupleElement(target, "0"), batches.Targets),
        TargetParameters: fn.arrayMap((target) => fn.tupleElement(target, "1"), batches.Targets),
        RepeatCount: fn.toString(batches.RepeatCount),
        SimulatorModel: batches.SimulatorModel,
        JudgeModel: batches.JudgeModel,
        Parameters: batches.Parameters,
        FirstTargetParameters: batches.FirstTargetParameters,
        UsesNote: fn.toString(fn.max(batches.HasNote)),
        LastRunAtMs: fn.toString(fn.max(batches.BatchRunAt)),
      })
      .groupBy(
        batches.SetId,
        batches.Targets,
        batches.RepeatCount,
        batches.SimulatorModel,
        batches.JudgeModel,
        batches.Parameters,
        batches.FirstTargetParameters,
      )
      .orderBy(fn.max(batches.BatchRunAt), "DESC")
      .limit(Math.min(Math.max(1, limit), MAX_RUN_CONFIGURATIONS))
      .build();
  }
}
